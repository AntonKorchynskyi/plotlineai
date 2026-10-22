import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  awsModulesUsed,
  buildInput,
  cap,
  decide,
  instructions,
  MARKER,
  parseResponse,
  reduceDiff,
  renderComment,
  review,
} from "./review-dependency-pr.mjs";

const LOCK_DIFF = `diff --git a/frontend/package.json b/frontend/package.json
--- a/frontend/package.json
+++ b/frontend/package.json
@@ -20,7 +20,7 @@
-    "next": "16.3.8",
+    "next": "16.4.2",
diff --git a/frontend/package-lock.json b/frontend/package-lock.json
--- a/frontend/package-lock.json
+++ b/frontend/package-lock.json
@@ -1844,15 +1844,15 @@
     "node_modules/@next/env": {
-      "version": "16.3.8",
-      "resolved": "https://registry.npmjs.org/@next/env/-/env-16.3.8.tgz",
-      "integrity": "sha512-old",
+      "version": "16.4.2",
+      "resolved": "https://registry.npmjs.org/@next/env/-/env-16.4.2.tgz",
+      "integrity": "sha512-new",
       "license": "MIT"
+    "node_modules/left-pad": {
+      "version": "1.3.0",
+      "engines": {
+        "node": ">=20"
+      },
-    "node_modules/old-thing": {
-      "version": "2.0.0",`;

const completed = (text) => ({
  status: "completed",
  output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text }] }],
});

const approve = { verdict: "approve", summary: "Routine fixes.", risks: [] };

describe("reduceDiff", () => {
  it("keeps manifests and shrinks lockfiles to version changes", () => {
    const reduced = reduceDiff(LOCK_DIFF);
    assert.match(reduced, /\+    "next": "16\.4\.2"/);
    assert.match(reduced, /@next\/env: 16\.3\.8 -> 16\.4\.2/);
    assert.match(reduced, /added left-pad@1\.3\.0/);
    assert.match(reduced, /removed old-thing@2\.0\.0/);
    assert.doesNotMatch(reduced, /integrity|resolved|engines/);
  });
});

describe("awsModulesUsed", () => {
  it("reads the aws-cdk-lib modules the real infra code imports", () => {
    const infra = (dir) => fileURLToPath(new URL(`../../infra/${dir}`, import.meta.url));
    const modules = awsModulesUsed(infra("lib"), infra("bin"));
    for (const used of ["aws-lambda", "aws-dynamodb", "aws-redshiftserverless", "aws-cloudfront"]) {
      assert.ok(modules.includes(used), `${used} missing from ${modules}`);
    }
    assert.ok(!modules.includes("aws-appsync"));
    assert.deepEqual(modules, [...new Set(modules)].sort());
  });
});

describe("instructions", () => {
  it("tells the model which CDK modules count, and only when there are some", () => {
    assert.match(instructions(["aws-lambda", "aws-s3"]), /imports: aws-lambda, aws-s3\./);
    assert.doesNotMatch(instructions([]), /BREAKING CHANGES/);
    assert.match(instructions([]), /untrusted data/);
  });
});

describe("cap", () => {
  it("leaves short text alone and says how much it cut", () => {
    assert.equal(cap("abc", 5), "abc");
    assert.match(cap("abcdefgh", 5), /^abcde\n\n\[\.\.\. 3 more characters cut\]$/);
  });
});

describe("buildInput", () => {
  it("wraps everything in the untrusted block and caps the body", () => {
    const input = buildInput({ title: "Bump x", body: "y".repeat(50_000), updateType: "version-update:semver-patch", diff: "" });
    assert.match(input, /^<pull_request>/);
    assert.match(input, /<\/pull_request>$/);
    assert.match(input, /10000 more characters cut/);
  });
});

describe("parseResponse", () => {
  it("reads the structured verdict", () => {
    assert.deepEqual(parseResponse(completed(JSON.stringify(approve))), approve);
  });

  it("rejects incomplete answers, refusals, bad JSON and wrong shapes", () => {
    assert.throws(() => parseResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), /incomplete/);
    assert.throws(() => parseResponse({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }), /refused/);
    assert.throws(() => parseResponse(completed("not json")), SyntaxError);
    assert.throws(() => parseResponse(completed(JSON.stringify({ verdict: "yes", summary: "", risks: [] }))), /schema/);
    assert.throws(() => parseResponse({ status: "completed", output: [] }), /no text/);
  });
});

describe("review", () => {
  it("fails without a key and never calls the API", async () => {
    let called = false;
    await assert.rejects(review({ apiKey: "", model: "m", input: "", fetchImpl: () => (called = true) }), /not set/);
    assert.equal(called, false);
  });

  it("turns an HTTP error into a readable failure", async () => {
    const fetchImpl = async () => new Response('{"error":{"message":"quota"}}', { status: 429 });
    await assert.rejects(review({ apiKey: "k", model: "m", input: "", fetchImpl }), /HTTP 429: .*quota/);
  });

  it("sends a strict schema and returns the verdict", async () => {
    let sent;
    const fetchImpl = async (_url, init) => {
      sent = JSON.parse(init.body);
      return Response.json(completed(JSON.stringify(approve)));
    };
    assert.deepEqual(await review({ apiKey: "k", model: "m", system: "rules", input: "x", fetchImpl }), approve);
    assert.equal(sent.text.format.strict, true);
    assert.equal(sent.instructions, "rules");
  });
});

describe("decide", () => {
  const patch = "version-update:semver-patch";

  it("auto-merges only approved minor and patch updates", () => {
    assert.equal(decide({ updateType: patch, result: approve }).autoMerge, true);
    assert.equal(decide({ updateType: "version-update:semver-minor", result: approve }).autoMerge, true);
    assert.equal(decide({ updateType: "version-update:semver-major", result: approve }).autoMerge, false);
    assert.equal(decide({ updateType: "", result: approve }).autoMerge, false);
  });

  it("never auto-merges a block or a failed review", () => {
    assert.equal(decide({ updateType: patch, result: { ...approve, verdict: "block" } }).autoMerge, false);
    assert.equal(decide({ updateType: patch, result: null, error: "timeout" }).autoMerge, false);
  });
});

describe("renderComment", () => {
  it("starts with the marker so the workflow can update it in place", () => {
    const comment = renderComment({ model: "m", result: { ...approve, risks: ["check X"] }, decision: { autoMerge: true, reason: "ok" } });
    assert.ok(comment.startsWith(MARKER));
    assert.match(comment, /- check X/);
  });
});
