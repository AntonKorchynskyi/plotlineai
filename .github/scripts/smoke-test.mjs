// Checks the live site after a deploy: node .github/scripts/smoke-test.mjs https://<site>
// Read-only on purpose: no uploads, shares or AI calls, so it creates no data and spends no AI
// budget. The gallery request still runs the whole chain (CloudFront, web, api, the stored
// datasets and the aggregation engine). Each check retries for a while, because the first
// requests after a deploy hit cold functions and CloudFront may still be switching over.

import { pathToFileURL } from "node:url";

const ATTEMPTS = 6;
const DELAY_MS = 15_000;
const TIMEOUT_MS = 30_000;

async function get(site, path, init = {}, fetchImpl = fetch) {
  return fetchImpl(new URL(path, site), { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
}

export function checks(site, fetchImpl = fetch) {
  return [
    {
      name: "landing page renders with its examples",
      async run() {
        const res = await get(site, "/", {}, fetchImpl);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        for (const header of ["strict-transport-security", "content-security-policy"]) {
          if (!res.headers.get(header)) throw new Error(`no ${header} header`);
        }
        const html = await res.text();
        if (!html.includes("Hand it a spreadsheet")) throw new Error("the hero text is missing");
        // The page still answers 200 when the api is down, but swaps the gallery for these cards.
        for (const marker of ["Examples are offline", "No examples to show"]) {
          if (html.includes(marker)) throw new Error(`the page says "${marker}"`);
        }
        const script = html.match(/\/_next\/static\/[^"]+\.js/)?.[0];
        if (!script) throw new Error("no /_next/static script on the page");
        const asset = await get(site, script, {}, fetchImpl);
        if (asset.status !== 200) throw new Error(`${script} answered HTTP ${asset.status}`);
      },
    },
    {
      name: "gallery api renders every example",
      async run() {
        const res = await get(site, "/api/backend/gallery", {}, fetchImpl);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) throw new Error("no examples returned");
        const empty = items.filter((item) => !item.renderedData?.datasets?.some((d) => d.data?.length));
        if (empty.length) throw new Error(`no data for ${empty.map((item) => item.slug).join(", ")}`);
      },
    },
    {
      name: "internal api routes stay hidden",
      async run() {
        const res = await get(site, "/api/backend/internal/ai-budget/consume", { method: "POST" }, fetchImpl);
        if (res.status !== 404) throw new Error(`HTTP ${res.status}, expected 404`);
      },
    },
  ];
}

/** Runs each check until it passes or runs out of attempts; resolves to the failures. */
export async function runChecks(list, { attempts = ATTEMPTS, delayMs = DELAY_MS, log = console.log } = {}) {
  const failures = [];
  for (const check of list) {
    for (let attempt = 1; ; attempt++) {
      try {
        await check.run();
        log(`ok   ${check.name}`);
        break;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        if (attempt >= attempts) {
          log(`FAIL ${check.name}: ${reason}`);
          failures.push({ name: check.name, reason });
          break;
        }
        log(`...  ${check.name}: ${reason} (attempt ${attempt} of ${attempts}, retrying)`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = process.argv[2];
  if (!site) {
    console.error("usage: node .github/scripts/smoke-test.mjs https://<site>");
    process.exit(2);
  }
  const failures = await runChecks(checks(site));
  process.exit(failures.length ? 1 : 0);
}
