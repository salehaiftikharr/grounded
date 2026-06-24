/**
 * Grounded CLI
 *
 *   grounded ingest [dir]      index a corpus of .md/.txt files (default: ./corpus)
 *   grounded ask "<question>"  answer from the indexed corpus, with citations,
 *                              or refuse if the question is not grounded
 *   grounded eval              grade retrieval hit-rate and grounding discipline
 *
 *   --provider anthropic|openai   override LLM_PROVIDER for generation
 */
import path from "node:path";
import { loadEnv } from "./env";
import { ingestDir } from "./ingest";
import { retrieve } from "./retrieve";
import { answerQuestion } from "./answer";
import { VectorStore } from "./store";
import { evaluate } from "./eval/grade";

loadEnv();

const INDEX = path.join(process.cwd(), "index.json");
const CORPUS = path.join(process.cwd(), "corpus");

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parse(argv: string[]): { positionals: string[]; provider?: string } {
  const positionals: string[] = [];
  let provider: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider") provider = argv[++i];
    else positionals.push(argv[i]);
  }
  return { positionals, provider };
}

async function main(): Promise<void> {
  const { positionals, provider } = parse(process.argv.slice(2));
  const [command, ...rest] = positionals;

  switch (command) {
    case "ingest": {
      const dir = rest[0] ? path.resolve(rest[0]) : CORPUS;
      const store = await ingestDir(dir, { onLog: (m) => console.log(m) });
      store.persist(INDEX);
      console.log(`✓ indexed ${store.size} chunk(s) → ${path.relative(process.cwd(), INDEX)}`);
      break;
    }

    case "ask": {
      const question = rest.join(" ").trim();
      if (!question) fail('Usage: grounded ask "<question>"');
      const store = VectorStore.load(INDEX);
      if (!store.size) fail("No index yet. Run: npm run grounded ingest");
      const hits = await retrieve(store, question);
      const answer = await answerQuestion(question, hits, { provider });
      console.log("");
      console.log(answer.text);
      if (answer.grounded && answer.citations.length) {
        console.log("\nSources:");
        for (const c of answer.citations) {
          console.log(`  - ${c.source ?? c.id} (score ${c.score.toFixed(2)})`);
        }
      }
      break;
    }

    case "eval": {
      const store = VectorStore.load(INDEX);
      if (!store.size) fail("No index yet. Run: npm run grounded ingest");
      console.log("Grounded-RAG eval — retrieval hit-rate and grounding discipline\n");
      const report = await evaluate(store, { provider, onLog: (m) => console.log(`  ${m}`) });
      console.log("");
      for (const r of report.results) {
        const mark = r.correct ? "✓" : "✗";
        const detail =
          r.expectSource === null
            ? `out-of-corpus → ${r.grounded ? "ANSWERED (should refuse)" : "refused"}`
            : `expect ${r.expectSource} → ${r.retrievalHit ? "retrieved" : "missed"} (top ${r.topScore.toFixed(2)})`;
        console.log(`${mark} ${detail}`);
      }
      console.log(
        `\nRetrieval hit-rate: ${report.retrieval.hits}/${report.retrieval.total} (${(report.retrieval.rate * 100).toFixed(0)}%)`,
      );
      console.log(`Refused out-of-corpus correctly: ${report.refusal.correct}/${report.refusal.total}`);
      console.log(`Accuracy: ${report.correct}/${report.total} (${(report.accuracy * 100).toFixed(0)}%)`);
      process.exitCode = report.correct === report.total ? 0 : 1;
      break;
    }

    default:
      console.log(
        [
          "Grounded — a retrieval Q&A agent that cites sources and refuses when ungrounded.",
          "",
          "  grounded ingest [dir]      index a corpus of .md/.txt files (default: ./corpus)",
          '  grounded ask "<question>"  answer from the corpus with citations, or refuse',
          "  grounded eval              grade retrieval hit-rate and grounding discipline",
          "",
          "  --provider anthropic|openai   override the generation provider",
        ].join("\n"),
      );
      if (command && command !== "help") process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
