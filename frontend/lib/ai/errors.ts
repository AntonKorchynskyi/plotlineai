/**
 * The AI layer's two failure modes, as the route handlers report them. Messages here are for
 * logs; routes answer with generic text and never echo them.
 */

/** No key configured, the daily ceiling is spent, or the provider failed or timed out. */
export class AiUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiUnavailableError";
  }
}

/** The daily ceiling is spent: the api refused the call before any provider was asked. */
export class AiBudgetRefusedError extends AiUnavailableError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiBudgetRefusedError";
  }
}

/** The model answered, but with something the ChartSpec contract rejects. */
export class AiBadOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiBadOutputError";
  }
}

/**
 * Even after a second try, no suggested chart passed the check against the dataset: usually a
 * file with nothing numeric to plot. Routes answer it apart from a malformed answer, because
 * the user can still describe a chart.
 */
export class AiNoChartError extends AiBadOutputError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiNoChartError";
  }
}
