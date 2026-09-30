// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLambda } from "./build-lambda.mjs";

/** A frontend directory holding just enough of a `next build` output. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "build-lambda-"));
  const write = (path: string, content: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  write(".next/standalone/server.js", "server");
  write(".next/standalone/.next/BUILD_ID", "build");
  write(".next/standalone/node_modules/next/package.json", "{}");
  write(".next/static/chunks/app.js", "chunk");
  write("public/favicon.ico", "icon");
  return root;
}

describe("buildLambda", () => {
  it("lays out the standalone server, public files and run.sh", () => {
    const root = fixture();
    const out = buildLambda({ root });

    expect(out).toBe(join(root, ".lambda"));
    expect(readFileSync(join(out, "server.js"), "utf8")).toBe("server");
    expect(existsSync(join(out, ".next", "BUILD_ID"))).toBe(true);
    expect(existsSync(join(out, "node_modules", "next", "package.json"))).toBe(true);
    expect(readFileSync(join(out, "public", "favicon.ico"), "utf8")).toBe("icon");
    // CloudFront serves these from S3.
    expect(existsSync(join(out, ".next", "static"))).toBe(false);
    expect(readFileSync(join(out, "run.sh"), "utf8")).toBe("#!/bin/sh\nexec node server.js\n");
  });

  it.skipIf(process.platform === "win32")("makes run.sh executable", () => {
    const out = buildLambda({ root: fixture() });
    expect(statSync(join(out, "run.sh")).mode & 0o777).toBe(0o755);
  });

  it("replaces the previous bundle", () => {
    const root = fixture();
    const out = buildLambda({ root });
    writeFileSync(join(out, "stale.js"), "old");
    buildLambda({ root });
    expect(existsSync(join(out, "stale.js"))).toBe(false);
  });

  it("refuses to run before next build", () => {
    const root = mkdtempSync(join(tmpdir(), "build-lambda-"));
    expect(() => buildLambda({ root })).toThrow(/npm run build/);
  });
});
