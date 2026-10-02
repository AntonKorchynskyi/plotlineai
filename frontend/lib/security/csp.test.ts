import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "@/lib/security/csp";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.split(" ")[0] === name)
    ?.split(" ")
    .slice(1);

describe("buildCsp", () => {
  it("allows only nonce'd scripts, with no inline or eval escape hatch", () => {
    const csp = buildCsp("abc123");
    expect(directive(csp, "script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("nonces style tags and allows only style attributes inline", () => {
    const csp = buildCsp("abc123");
    expect(directive(csp, "style-src")).toEqual(["'self'", "'nonce-abc123'"]);
    expect(directive(csp, "style-src-attr")).toEqual(["'unsafe-inline'"]);
  });

  it("keeps everything else same-origin and forbids framing, plugins and base rewriting", () => {
    const csp = buildCsp("n");
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "connect-src")).toEqual(["'self'"]);
    expect(directive(csp, "img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
  });

  it("lets the page upload to the S3 bucket's origin, and nowhere else", () => {
    const csp = buildCsp("n", { uploadOrigin: "https://plotlineai-data.s3.us-east-1.amazonaws.com" });
    expect(directive(csp, "connect-src")).toEqual([
      "'self'",
      "https://plotlineai-data.s3.us-east-1.amazonaws.com",
    ]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
  });

  it("loosens only what the development server needs", () => {
    const csp = buildCsp("n", { dev: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
  });
});

describe("createNonce", () => {
  it("is 128 bits of base64, fresh every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
