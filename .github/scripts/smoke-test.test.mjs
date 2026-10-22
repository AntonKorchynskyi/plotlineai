import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checks, runChecks } from "./smoke-test.mjs";

const PAGE = `<html><h1>Hand it a spreadsheet.</h1><script src="/_next/static/chunks/app.js"></script></html>`;
const GALLERY = [{ slug: "a", renderedData: { datasets: [{ data: [1, 2] }] } }];
const SECURITY_HEADERS = { "strict-transport-security": "max-age=1", "content-security-policy": "default-src 'self'" };

/** A fake site: path -> [status, body, headers]; anything else is a 404. */
function site(routes) {
  return async (url) => {
    const [status, body, headers] = routes[new URL(url).pathname] ?? [404, ""];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  };
}

const healthy = {
  "/": [200, PAGE, SECURITY_HEADERS],
  "/_next/static/chunks/app.js": [200, ""],
  "/api/backend/gallery": [200, GALLERY],
};

async function failuresFor(routes) {
  return runChecks(checks("https://example.test", site(routes)), { attempts: 1, delayMs: 0, log: () => {} });
}

describe("smoke checks", () => {
  it("pass against a healthy site", async () => {
    assert.deepEqual(await failuresFor(healthy), []);
  });

  it("catch the gallery being down even though the page answers 200", async () => {
    const failures = await failuresFor({ ...healthy, "/": [200, PAGE + "Examples are offline", SECURITY_HEADERS] });
    assert.match(failures[0].reason, /Examples are offline/);
  });

  it("catch missing security headers, a broken asset, and empty chart data", async () => {
    const failures = await failuresFor({
      "/": [200, PAGE],
      "/api/backend/gallery": [200, [{ slug: "a", renderedData: { datasets: [] } }]],
    });
    assert.match(failures[0].reason, /strict-transport-security/);
    assert.match(failures[1].reason, /no data for a/);
  });

  it("catch an internal route that answers", async () => {
    const failures = await failuresFor({ ...healthy, "/api/backend/internal/ai-budget/consume": [200, "{}"] });
    assert.equal(failures.length, 1);
    assert.match(failures[0].reason, /expected 404/);
  });
});

describe("runChecks", () => {
  it("retries a failing check and stops once it passes", async () => {
    let calls = 0;
    const flaky = { name: "flaky", run: async () => { if (++calls < 3) throw new Error("cold"); } };
    assert.deepEqual(await runChecks([flaky], { attempts: 5, delayMs: 0, log: () => {} }), []);
    assert.equal(calls, 3);
  });
});
