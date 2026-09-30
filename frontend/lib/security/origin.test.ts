import { describe, expect, it } from "vitest";
import { isCrossSite, isStateChanging } from "@/lib/security/origin";

const request = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/suggest", {
    method: "POST",
    headers: { host: "localhost:3000", ...headers },
  });

describe("isCrossSite", () => {
  it("accepts the app's own origin", () => {
    expect(isCrossSite(request({ origin: "http://localhost:3000" }))).toBe(false);
    expect(isCrossSite(request({ "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("refuses another origin, even one differing only by port", () => {
    expect(isCrossSite(request({ origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSite(request({ origin: "http://localhost:4000" }))).toBe(true);
  });

  it("refuses what the browser marks cross-site, whatever the origin says", () => {
    expect(
      isCrossSite(request({ origin: "http://localhost:3000", "sec-fetch-site": "cross-site" })),
    ).toBe(true);
  });

  it("refuses an opaque or malformed origin", () => {
    expect(isCrossSite(request({ origin: "null" }))).toBe(true);
    expect(isCrossSite(request({ origin: "not a url" }))).toBe(true);
  });

  it("compares with the host the browser used when a proxy forwards it", () => {
    // On AWS: CloudFront calls web's function URL under its own host name and passes the
    // browser's in X-Forwarded-Host (infra/lib/app-stack.ts); Caddy does the same locally.
    const behindCloudFront = (headers: Record<string, string>) =>
      request({ host: "abc.lambda-url.us-east-1.on.aws", "x-forwarded-host": "d1.cloudfront.net", ...headers });
    expect(isCrossSite(behindCloudFront({ origin: "https://d1.cloudfront.net" }))).toBe(false);
    expect(isCrossSite(behindCloudFront({ origin: "https://abc.lambda-url.us-east-1.on.aws" }))).toBe(true);
    expect(isCrossSite(behindCloudFront({ origin: "https://evil.example" }))).toBe(true);
  });

  it("leaves a request with no browser markers to the rate limits", () => {
    expect(isCrossSite(request({}))).toBe(false);
  });
});

describe("isStateChanging", () => {
  it("treats everything but the safe methods as a write", () => {
    expect(["GET", "HEAD", "OPTIONS", "get"].map(isStateChanging)).toEqual([false, false, false, false]);
    expect(["POST", "PUT", "PATCH", "DELETE"].map(isStateChanging)).toEqual([true, true, true, true]);
  });
});
