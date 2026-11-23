import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function functionBody(name) {
  const match = html.match(
    new RegExp(`function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`),
  );
  assert.ok(match, `function ${name}() not found in index.html`);
  return match[1];
}

test("clearOutput clears the previous draft and hides the result block", () => {
  const body = functionBody("clearOutput");
  assert.match(body, /resultEl\.hidden\s*=\s*true/);
  assert.match(body, /draftEl\.value\s*=\s*""/);
});

test("showManual calls clearOutput before showing the manual block", () => {
  const body = functionBody("showManual");
  const clearAt = body.indexOf("clearOutput()");
  const showAt = body.indexOf("manualEl.hidden = false");
  assert.ok(clearAt !== -1, "showManual must call clearOutput()");
  assert.ok(showAt !== -1, "showManual must show the manual block");
  assert.ok(clearAt < showAt, "clearOutput() must run before the manual block is shown");
});

test("showReady clears the previous draft before setting a new one", () => {
  const body = functionBody("showReady");
  const clearAt = body.indexOf("clearOutput()");
  const setAt = body.indexOf("draftEl.value = data.draft");
  assert.ok(clearAt !== -1, "showReady must call clearOutput()");
  assert.ok(setAt !== -1, "showReady must set the new draft");
  assert.ok(clearAt < setAt, "clearOutput() must run before the new draft is set");
});

test("manual_review branch calls showManual", () => {
  assert.match(html, /data\?\.status === "manual_review"[\s\S]{0,300}showManual\(/);
});
