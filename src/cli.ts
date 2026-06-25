/**
 * Grounded CLI
 *
 *   grounded ingest [dir]      index a corpus of .md/.txt files (default: ./corpus)
 *   grounded ask "<question>"  answer from the indexed corpus, with citations and
 *                              a faithfulness check, or refuse if not grounded
 *   grounded verify "<q>" "<answer>"  run only the faithfulness check on a supplied
 *                              answer — watch unsupported claims get dropped
 *   grounded eval              grade retrieval hit-rate and grounding discipline
 *
 *   --provider anthropic|openai   override LLM_PROVIDER for generation
 *   --no-verify                   (ask) skip the faithfulness check
 *   --verify                      (eval) also measure answer faithfulness
 */
import path from "node:path";
import { loadEnv } from "./env";
import { ingestDir } from "./lib/ingest";
import { retrieve } from "./lib/retrieve";
import { answerQuestion } from "./lib/answer";
import { verifyFaithfulness } from "./lib/faithfulness";
import { VectorStore } from "./lib/store";
import { evaluate } from "./lib/eval/grade";

loadEnv();

const INDEX = path.join(process.cwd(), "index.json");
const CORPUS = path.join(process.cwd(), "corpus");

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parse(argv: string[]): { positionals: string[]; provider?: string; verify?: boolean } {
  const positionals: string[] = [];
  let provider: string | undefined;
  let verify: boolean | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider") provider = argv[++i];
    else if (argv[i] === "--verify") verify = true;
    else if (argv[i] === "--no-verify") verify = false;
    else positionals.push(argv[i]);
  }
  return { positionals, provider, verify };
}

async function main(): Promise<void> {
  const { positionals, provider, verify } = parse(process.argv.slice(2));
  const [command, ...rest] = positionals;

  switch (command) {
    case "ingest": {
      const dir = rest[0] ? path.resolve(rest[0]) : CORPUS;
      // Same chunk settings as scripts/precompute.ts, so the CLI index and the
      // web demo index behave identically.
      const store = await ingestDir(dir, { size: 420, overlap: 80, onLog: (m) => console.log(m) });
      store.persist(INDEX);
      console.log(`✓ indexed ${store.size} chunk(s) → ${path.relative(process.cwd(), INDEX)}`);
      break;
    }

    case "ask": {
      const question = rest.join(" ").trim();
      if (!question) fail('Usage: grounded ask "<question>"');
      const store = VectorStore.load(INDEX);
      if (!store.size) fail("No index yet. Run: npm run grounded ingest");
      const { hits, candidateScores } = await retrieve(store, question);
      // Verify by default on the CLI; pass --no-verify to skip the extra pass.
      const answer = await answerQuestion(question, hits, {
        provider,
        verify: verify !== false,
        candidateScores,
      });
      console.log("");
      console.log(answer.text);
      if (answer.grounded && answer.citations.length) {
        console.log("\nSources:");
        for (const c of answer.citations) {
          console.log(`  - ${c.source ?? c.id} (score ${c.score.toFixed(2)})`);
        }
      }
      const f = answer.faithfulness;
      if (f && f.claims.length) {
        const mark = f.verdict === "supported" ? "✓" : f.verdict === "partial" ? "⚠" : "✗";
        const supported = f.claims.length - f.unsupported.length;
        console.log(
          `\n${mark} Faithfulness: ${supported}/${f.claims.length} claims supported (${(f.score * 100).toFixed(0)}%)`,
        );
        for (const u of f.unsupported) console.log(`  ✗ unsupported: ${u}`);
      }
      if (answer.grounded) {
        const t = answer.timings;
        console.log(
          `\n[generate ${t.generateMs}ms · verify ${t.verifyMs}ms · ${answer.usage.total} tokens]`,
        );
      }
      break;
    }

    case "verify": {
      // Run ONLY the output-side faithfulness check on an answer you supply, so
      // the second gate can be seen firing: paste a plausible-but-unsupported
      // claim and watch it get dropped, independent of the generator.
      const q = rest[0]?.trim();
      const ans = rest[1]?.trim();
      if (!q || !ans) fail('Usage: grounded verify "<question>" "<answer to check>"');
      const store = VectorStore.load(INDEX);
      if (!store.size) fail("No index yet. Run: npm run grounded ingest");
      const { hits } = await retrieve(store, q);
      const f = await verifyFaithfulness(ans, hits, { provider });
      const supported = f.claims.length - f.unsupported.length;
      console.log(`\nVerdict: ${f.verdict} — ${supported}/${f.claims.length} claims hold up (${(f.score * 100).toFixed(0)}%)\n`);
      for (const c of f.claims) {
        const verified = c.supported && c.evidenceLocated;
        if (verified) {
          console.log(`  ✓ ${c.claim}`);
          console.log(`      ↳ verified in [${c.sourceIndex ?? "sources"}]: "${c.evidence}"`);
        } else {
          console.log(`  ✗ DROPPED: ${c.claim}`);
          if (c.supported && !c.evidenceLocated) {
            console.log(`      ↳ checker offered "${c.evidence}" but that text is not in any source`);
          }
        }
      }
      break;
    }

    case "eval": {
      const store = VectorStore.load(INDEX);
      if (!store.size) fail("No index yet. Run: npm run grounded ingest");
      console.log("Grounded eval — retrieval hit-rate, grounding discipline, faithfulness\n");
      const report = await evaluate(store, { provider, verify, onLog: (m) => console.log(`  ${m}`) });
      console.log("");
      for (const r of report.results) {
        if (r.expectSource === null) {
          const refused = !r.grounded;
          if (r.adversarial) {
            console.log(
              `${refused ? "✓" : "⚠"} adversarial near-miss → ${refused ? "refused" : "passed gate (caught downstream)"} (top ${r.topScore.toFixed(2)})`,
            );
          } else {
            console.log(
              `${refused ? "✓" : "✗"} out-of-corpus → ${refused ? "refused" : "ANSWERED (should refuse)"}`,
            );
          }
        } else {
          console.log(
            `${r.correct ? "✓" : "✗"} expect ${r.expectSource} → ${r.retrievalHit ? "retrieved" : "missed"} (top ${r.topScore.toFixed(2)})`,
          );
        }
      }
      console.log(
        `\nRetrieval hit-rate: ${report.retrieval.hits}/${report.retrieval.total} (${(report.retrieval.rate * 100).toFixed(0)}%)`,
      );
      console.log(`Refused clear out-of-corpus: ${report.refusal.correct}/${report.refusal.total}`);
      console.log(
        `Refused adversarial near-miss (gate alone): ${report.adversarial.refused}/${report.adversarial.total}`,
      );
      if (report.adversarial.refused < report.adversarial.total) {
        console.log(
          "  note: this leak is caught at GENERATION — the generator answers \"I don't know\" from\n" +
            "  the vocab-similar chunks (its own discretion, not the faithfulness gate). The mechanical\n" +
            "  faithfulness check fires only once a plausible answer is actually produced.",
        );
      }
      if (report.faithfulness) {
        console.log(
          `Mean faithfulness (${report.faithfulness.total} answered): ${(report.faithfulness.mean * 100).toFixed(0)}%`,
        );
      }
      if (report.quoteLocation) {
        const q = report.quoteLocation;
        console.log(
          `Quote-location rate (supported claims with a verbatim source span): ${q.located}/${q.supported} (${(q.rate * 100).toFixed(0)}%)`,
        );
      }
      console.log(`\n${report.passed ? "✓ PASS" : "✗ FAIL"} (retrieval hits + clear refusals)`);
      process.exitCode = report.passed ? 0 : 1;
      break;
    }

    default:
      console.log(
        [
          "Grounded — a retrieval Q&A agent that cites sources and refuses when ungrounded.",
          "",
          "  grounded ingest [dir]               index .md/.txt files (default: ./corpus)",
          '  grounded ask "<question>"           answer with citations + a faithfulness check, or refuse',
          '  grounded verify "<q>" "<answer>"    run only the faithfulness check on an answer you supply',
          "  grounded eval                       grade retrieval hit-rate and grounding discipline",
          "",
          "  --provider anthropic|openai   override the generation provider",
          "  --no-verify                   (ask) skip the faithfulness check",
          "  --verify                      (eval) also measure answer faithfulness",
        ].join("\n"),
      );
      if (command && command !== "help") process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
