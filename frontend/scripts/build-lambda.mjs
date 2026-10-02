// Assembles the web Lambda function's code from the `next build` output (run it after
// `npm run build`). The function runs Next's standalone server behind Lambda Web Adapter,
// which starts it through run.sh. `.next/static` is left out: CloudFront serves it from S3
// (infra/lib/app-stack.ts), and the files the server needs are all in the standalone output.
//
// Next writes nothing to disk at runtime here (every page is dynamic and no image optimization
// is used), so the read-only Lambda filesystem needs no writable cache directory.
import { chmodSync, cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUN_SH = "#!/bin/sh\nexec node server.js\n";

/**
 * @param {{ root: string, out?: string }} options `root` is the frontend directory; `out`
 *   defaults to `<root>/.lambda` and is replaced on every run.
 * @returns {string} the bundle directory
 */
export function buildLambda({ root, out = join(root, ".lambda") }) {
  const standalone = join(root, ".next", "standalone");
  if (!existsSync(join(standalone, "server.js"))) {
    throw new Error(`${standalone}/server.js is missing: run \`npm run build\` first`);
  }
  rmSync(out, { recursive: true, force: true });
  cpSync(standalone, out, { recursive: true });
  const publicDir = join(root, "public");
  if (existsSync(publicDir)) cpSync(publicDir, join(out, "public"), { recursive: true });
  writeFileSync(join(out, "run.sh"), RUN_SH);
  chmodSync(join(out, "run.sh"), 0o755);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildLambda({ root: resolve(fileURLToPath(import.meta.url), "..", "..") });
  console.log(`web Lambda bundle ready in ${out}`);
}
