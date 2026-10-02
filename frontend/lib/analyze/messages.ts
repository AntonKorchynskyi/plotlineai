import type { Failure } from "@/lib/analyze/client";

/**
 * What the user reads when something fails. The api's own messages are deliberately generic
 * and phrased for logs, so the UI writes its own copy per code and never echoes the server.
 */

/** `fileFault` says whether another file could fix it, which decides what the screen offers. */
type Rejection = { heading: string; detail: string; fileFault: boolean };

const REJECTIONS: Record<string, Rejection> = {
  INVALID_FILE_TYPE: {
    heading: "That file was not a CSV",
    detail:
      "Only comma separated values can be read. Export your file as a CSV and try again.",
    fileFault: true,
  },
  FILE_TOO_LARGE: {
    heading: "That file is too large",
    detail:
      "Uploads stop at 5 MB. Trim the rows or columns you do not need and try again.",
    fileFault: true,
  },
  MALFORMED_CSV: {
    heading: "That file could not be read",
    detail:
      "The contents did not parse as CSV. Check it has one header row and is saved as UTF-8 text.",
    fileFault: true,
  },
  CAP_EXCEEDED: {
    heading: "That file is too big to chart",
    detail:
      "It went past the limits below. A smaller extract of the same data will work.",
    fileFault: true,
  },
  UPLOAD_QUOTA_REACHED: {
    heading: "Uploads are paused for today",
    detail: "The demo's daily upload allowance is used up. Try again tomorrow.",
    fileFault: false,
  },
  UPLOAD_NOT_FOUND: {
    heading: "The upload did not finish",
    detail: "The file did not arrive in time to be read. Try uploading it again.",
    fileFault: false,
  },
  NETWORK: {
    heading: "Could not reach the server",
    detail:
      "The upload did not get through. Check your connection and try again.",
    fileFault: false,
  },
};

export function rejectionCopy(failure: Failure): Rejection {
  if (failure.code === "RATE_LIMITED") {
    return {
      heading: "Too many uploads for now",
      detail: failure.retryAfterSeconds
        ? `Uploads are limited to keep the service up for everyone. Try again in ${failure.retryAfterSeconds} seconds.`
        : "Uploads are limited to keep the service up for everyone. Try again shortly.",
      fileFault: false,
    };
  }
  const known = REJECTIONS[failure.code];
  if (known) return known;
  // No answer, or a server error with no code we know (a restart, a cold start that timed
  // out): nothing another file would change.
  if (failure.status === 0 || failure.status >= 500) {
    return {
      heading: "Something went wrong on our side",
      detail: "The upload did not go through. Give it a moment and try again.",
      fileFault: false,
    };
  }
  return {
    heading: "That file could not be used",
    detail: "Something about it stopped us reading it. Try another CSV.",
    fileFault: true,
  };
}

export function noticeCopy(failure: Failure): string {
  switch (failure.code) {
    case "RATE_LIMITED":
      return failure.retryAfterSeconds
        ? `Too many requests. Try again in ${failure.retryAfterSeconds} seconds.`
        : "Too many requests. Try again shortly.";
    case "AI_UNAVAILABLE":
      return "Chart suggestions are unavailable right now. You can still describe a chart later, or try again in a moment.";
    case "AI_BAD_OUTPUT":
      return "That came back in a shape we could not use. Try rewording your request.";
    case "NOT_FOUND":
      return "This dataset has expired. Upload the file again to carry on.";
    case "SHARE_TOO_LARGE":
      return "This chart is too large to share. Narrow it with a filter or a limit.";
    case "INVALID_CHART_SPEC":
      return "That chart could not be built from this data. Try rewording your request.";
    case "NETWORK":
      return "Could not reach the server. Check your connection and try again.";
    default:
      return "Something went wrong. Try again in a moment.";
  }
}
