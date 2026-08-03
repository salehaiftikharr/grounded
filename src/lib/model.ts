import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * The provider seam — the only place that names a vendor. Generation flips
 * between Claude and GPT with one env var; embeddings use OpenAI by default.
 */
export function getChatModel(override?: string): LanguageModel {
  const provider = (override || process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (provider === "openai") return openai(process.env.OPENAI_MODEL || "gpt-4.1");
  if (provider === "anthropic") return anthropic(process.env.ANTHROPIC_MODEL || "claude-opus-4-8");
  throw new Error(`Unknown provider "${provider}". Expected "anthropic" or "openai".`);
}

/**
 * The model that fact-checks an answer. Deliberately from a DIFFERENT family than
 * the generator: a generator and a checker built on the same weights share blind
 * spots, so a model that hallucinates something plausible may also rationalize it
 * as supported. By default anthropic generation is checked by OpenAI (and vice
 * versa), which the app can always do since the OpenAI key is already required for
 * embeddings. CHECKER_PROVIDER / CHECKER_MODEL override the choice.
 */
export function getCheckerModel(genProvider?: string): LanguageModel {
  const gen = (genProvider || process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const provider = (process.env.CHECKER_PROVIDER || (gen === "openai" ? "anthropic" : "openai")).toLowerCase();
  if (provider === "openai") return openai(process.env.CHECKER_MODEL || "gpt-4.1-mini");
  if (provider === "anthropic") return anthropic(process.env.CHECKER_MODEL || "claude-haiku-4-5-20251001");
  throw new Error(`Unknown checker provider "${provider}". Expected "anthropic" or "openai".`);
}

export function getEmbeddingModel() {
  return openai.embedding(process.env.EMBEDDING_MODEL || "text-embedding-3-small");
}
