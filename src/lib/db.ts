import { sql } from "@vercel/postgres";
import type { SearchHit, StoredChunk } from "./store";

/**
 * Postgres + pgvector store for user-uploaded corpora. The default demo corpus
 * still lives in the committed in-memory index (see loadIndex); this backs the
 * "bring your own document" path, where each visitor's upload is namespaced by a
 * session id and expires on a TTL so the table does not grow without bound.
 *
 * This is the production swap point the in-memory VectorStore always pointed to:
 * search happens in the database via the pgvector cosine operator (<=>), and the
 * rest of the pipeline — rerank, grounding gate, faithfulness — is unchanged.
 */

// text-embedding-3-small produces 1536-dimensional vectors.
const EMBEDDING_DIM = 1536;

// Uploaded corpora older than this are deleted opportunistically on each ingest.
const TTL_HOURS = 24;

let schemaReady = false;

/** Create the extension, table, and indexes once per process. */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql.query(`
    CREATE TABLE IF NOT EXISTS uploaded_chunks (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      doc_id      TEXT NOT NULL,
      source      TEXT,
      text        TEXT NOT NULL,
      embedding   vector(${EMBEDDING_DIM}) NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await sql`CREATE INDEX IF NOT EXISTS uploaded_chunks_session_idx ON uploaded_chunks (session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS uploaded_chunks_created_idx ON uploaded_chunks (created_at)`;
  schemaReady = true;
}

/** pgvector wants a vector literal like "[0.1,0.2,...]". */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface IngestChunk {
  id: string;
  docId: string;
  source?: string;
  text: string;
  embedding: number[];
}

/** Replace this session's corpus with the given chunks (upload is authoritative). */
export async function replaceSessionChunks(sessionId: string, chunks: IngestChunk[]): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM uploaded_chunks WHERE session_id = ${sessionId}`;
  for (const c of chunks) {
    await sql`
      INSERT INTO uploaded_chunks (id, session_id, doc_id, source, text, embedding)
      VALUES (
        ${c.id},
        ${sessionId},
        ${c.docId},
        ${c.source ?? null},
        ${c.text},
        ${toVectorLiteral(c.embedding)}::vector
      )
    `;
  }
}

/** How many chunks this session currently has stored. */
export async function sessionChunkCount(sessionId: string): Promise<number> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT count(*)::int AS n FROM uploaded_chunks WHERE session_id = ${sessionId}
  `;
  return rows[0]?.n ?? 0;
}

/** The distinct source filenames stored for this session. */
export async function sessionSources(sessionId: string): Promise<string[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT DISTINCT source FROM uploaded_chunks
    WHERE session_id = ${sessionId} AND source IS NOT NULL
    ORDER BY source
  `;
  return rows.map((r) => r.source as string);
}

/** Drop this session's uploaded corpus (reset to the default demo corpus). */
export async function clearSession(sessionId: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM uploaded_chunks WHERE session_id = ${sessionId}`;
}

/**
 * Top-k candidates for a session's corpus by cosine similarity. Returns the same
 * SearchHit shape as the in-memory store so retrieve()'s rerank works unchanged.
 * pgvector's <=> is cosine DISTANCE (0 = identical), so similarity = 1 - distance.
 */
export async function searchSessionChunks(
  sessionId: string,
  queryEmbedding: number[],
  k: number,
): Promise<SearchHit[]> {
  await ensureSchema();
  const vec = toVectorLiteral(queryEmbedding);
  const { rows } = await sql.query(
    `SELECT id, doc_id, source, text, 1 - (embedding <=> $1::vector) AS score
     FROM uploaded_chunks
     WHERE session_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vec, sessionId, k],
  );
  return rows.map((r) => {
    const chunk: StoredChunk = {
      id: r.id,
      docId: r.doc_id,
      text: r.text,
      source: r.source ?? undefined,
      // The embedding is not needed downstream; the score is already computed.
      embedding: [],
    };
    return { chunk, score: Number(r.score) };
  });
}

/** Delete uploaded corpora older than the TTL. Cheap; called on each ingest. */
export async function cleanupExpired(): Promise<void> {
  await ensureSchema();
  await sql.query(
    `DELETE FROM uploaded_chunks WHERE created_at < now() - ($1 || ' hours')::interval`,
    [String(TTL_HOURS)],
  );
}
