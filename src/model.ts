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

export function getEmbeddingModel() {
  return openai.embedding(process.env.EMBEDDING_MODEL || "text-embedding-3-small");
}
