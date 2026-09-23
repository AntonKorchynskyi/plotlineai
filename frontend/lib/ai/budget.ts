import { AiUnavailableError } from "@/lib/ai/errors";

/**
 * The cost circuit breaker: a global ceiling on provider calls per UTC day. Unlike the
 * per-IP rate limit, it cannot be dodged by spoofing a client address.
 *
 * Held in memory, which is right for the single web instance this project runs. More than
 * one instance would need the count in a shared store.
 */

const DEFAULT_DAILY_LIMIT = 500;

export type DailyBudget = {
  /** Takes one call from today's allowance, or throws AiUnavailableError when it is spent. */
  consume(): void;
  remaining(): number;
};

export function createDailyBudget(options: {
  limit: number;
  now?: () => Date;
}): DailyBudget {
  const now = options.now ?? (() => new Date());
  let day = "";
  let used = 0;
  let reported = false;

  const roll = () => {
    const today = now().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = 0;
      reported = false;
    }
  };

  return {
    consume() {
      roll();
      if (used >= options.limit) {
        if (!reported) {
          reported = true;
          console.warn(
            JSON.stringify({ event: "ai_daily_limit_reached", limit: options.limit, day }),
          );
        }
        throw new AiUnavailableError("daily AI call limit reached");
      }
      used += 1;
    },
    remaining() {
      roll();
      return Math.max(0, options.limit - used);
    },
  };
}

export function dailyLimitFromEnv(): number {
  const raw = process.env.AI_DAILY_CALL_LIMIT;
  const parsed = Number(raw);
  return raw && Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

/** The process-wide budget both AI calls draw from. */
export const dailyBudget = createDailyBudget({ limit: dailyLimitFromEnv() });
