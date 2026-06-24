/**
 * Lightweight observability for a single question: where the time went and how
 * many tokens it cost. The same instinct as tracing an agent loop — you cannot
 * trust what you cannot see — applied to one RAG request.
 */

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, total: 0 };

/**
 * Normalize the AI SDK's usage object, which has shifted field names across
 * versions (promptTokens/completionTokens → inputTokens/outputTokens). Defensive
 * so a provider quirk never crashes a request.
 */
export function normalizeUsage(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, number | undefined>;
  const input = u.inputTokens ?? u.promptTokens ?? 0;
  const output = u.outputTokens ?? u.completionTokens ?? 0;
  const total = u.totalTokens ?? input + output;
  return { input, output, total };
}

/** Add up several usage records (e.g. generation + the faithfulness check). */
export function sumUsage(...usages: TokenUsage[]): TokenUsage {
  return usages.reduce<TokenUsage>(
    (acc, u) => ({
      input: acc.input + u.input,
      output: acc.output + u.output,
      total: acc.total + u.total,
    }),
    { ...ZERO_USAGE },
  );
}

/** Run an async step and report how long it took, in milliseconds. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}
