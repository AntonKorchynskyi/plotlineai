import { describe, expect, it } from "vitest";
import type { Failure } from "@/lib/analyze/client";
import { noticeCopy, rejectionCopy } from "@/lib/analyze/messages";

const failure = (code: string, extra: Partial<Failure> = {}): Failure => ({
  ok: false,
  code,
  message: "raw server message",
  status: 400,
  ...extra,
});

describe("rejectionCopy", () => {
  it.each([
    ["INVALID_FILE_TYPE", /not a csv/i],
    ["FILE_TOO_LARGE", /too large|5 mb/i],
    ["MALFORMED_CSV", /could not be read/i],
    ["CAP_EXCEEDED", /too (big|large)|limits/i],
    ["NETWORK", /reach/i],
  ])("explains %s in its own words", (code, expected) => {
    const copy = rejectionCopy(failure(code));
    expect(copy.heading).toMatch(/\w/);
    expect(`${copy.heading} ${copy.detail}`).toMatch(expected);
  });

  it("never shows the server's raw message", () => {
    const copy = rejectionCopy(failure("MALFORMED_CSV"));
    expect(`${copy.heading} ${copy.detail}`).not.toContain("raw server message");
  });

  it("says a full store is not the file's fault, and that it clears on its own", () => {
    const copy = rejectionCopy(failure("STORAGE_FULL", { status: 503 }));
    expect(copy.heading).toBe("Uploads are paused for now");
    expect(copy.detail).toBe(
      "The demo's storage is full. Older uploads clear out within a day, so try again later.",
    );
  });

  it.each([
    ["a server error", 500],
    ["a gateway timeout", 504],
    ["no response at all", 0],
  ])("does not blame the file for %s with an unknown code", (_, status) => {
    const copy = rejectionCopy(failure("UNKNOWN", { status }));
    expect(copy.fileFault).toBe(false);
    expect(copy.heading).toBe("Something went wrong on our side");
  });

  it("falls back for an unknown code", () => {
    expect(rejectionCopy(failure("SOMETHING_NEW")).heading).toMatch(/\w/);
  });

  it("says a rate-limited upload is not the file's fault, and how long to wait", () => {
    const copy = rejectionCopy(failure("RATE_LIMITED", { retryAfterSeconds: 14 }));
    expect(copy.heading).toMatch(/too many uploads/i);
    expect(copy.detail).toMatch(/14 seconds/);
    expect(rejectionCopy(failure("RATE_LIMITED")).detail).toMatch(/shortly/);
  });
});

describe("noticeCopy", () => {
  it("says how long to wait when rate limited", () => {
    expect(noticeCopy(failure("RATE_LIMITED", { retryAfterSeconds: 9 }))).toMatch(/9 seconds/);
  });

  it("copes with a rate limit that carries no retry time", () => {
    expect(noticeCopy(failure("RATE_LIMITED"))).toMatch(/too many|shortly/i);
  });

  it.each([
    ["AI_UNAVAILABLE", /unavailable/i],
    ["AI_BAD_OUTPUT", /again|reword/i],
    ["NOT_FOUND", /expired/i],
    ["INVALID_CHART_SPEC", /could not|reword/i],
    ["NETWORK", /reach/i],
  ])("explains %s", (code, expected) => {
    expect(noticeCopy(failure(code))).toMatch(expected);
  });

  it("never shows the server's raw message", () => {
    expect(noticeCopy(failure("AI_UNAVAILABLE"))).not.toContain("raw server message");
  });
});
