import { z } from "zod";
import { AiUnavailableError } from "@/lib/ai/errors";
import { backendUrl } from "@/lib/backend";

/**
 * The cost circuit breaker: a global ceiling on provider calls per UTC day. Unlike the
 * per-IP rate limit, it cannot be dodged by spoofing a client address.
 *
 * The count lives in the api's database, not here. web can restart at any time (on Cloud
 * Run, every cold start), and a counter in memory would start each life with a fresh
 * allowance. The limit itself is the api's AI_DAILY_CALL_LIMIT.
 */

export type DailyBudget = {
  /** Takes one call from today's allowance, or throws AiUnavailableError when it cannot. */
  consume(): Promise<void>;
};

const ConsumeResponseSchema = z.object({ allowed: z.boolean() });

/**
 * A budget kept by the api. It fails closed: if the api cannot say yes, the call does not
 * happen, because a provider call nobody counted is exactly what the ceiling exists to stop.
 */
export function createApiBudget(
  deps: { fetch?: typeof fetch; baseUrl?: () => string; timeoutMs?: number } = {},
): DailyBudget {
  const send = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const baseUrl = deps.baseUrl ?? backendUrl;
  const timeoutMs = deps.timeoutMs ?? 5000;

  return {
    async consume() {
      let answer: unknown;
      try {
        const response = await send(`${baseUrl()}/internal/ai-budget/consume`, {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`api answered ${response.status}`);
        answer = await response.json();
      } catch (cause) {
        throw new AiUnavailableError("daily AI budget unavailable", { cause });
      }

      const parsed = ConsumeResponseSchema.safeParse(answer);
      if (!parsed.success) throw new AiUnavailableError("unexpected daily AI budget answer");
      if (!parsed.data.allowed) throw new AiUnavailableError("daily AI call limit reached");
    },
  };
}

/** The process-wide budget both AI calls draw from. */
export const dailyBudget = createApiBudget();
