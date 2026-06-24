import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/env";
import { ingestDir } from "../src/lib/ingest";

/**
 * Build the corpus index for the web app and write it to data/index.json so it
 * can be committed and shipped with the deployment. Run once (and re-run when
 * the corpus changes): `npm run precompute`. Requires OPENAI_API_KEY.
 */
loadEnv();

const corpus = path.join(process.cwd(), "corpus");
const dataDir = path.join(process.cwd(), "data");
const out = path.join(dataDir, "index.json");

const store = await ingestDir(corpus, { onLog: (m) => console.log(m) });
mkdirSync(dataDir, { recursive: true });
store.persist(out);
console.log(`✓ wrote ${store.size} chunk(s) → data/index.json`);
