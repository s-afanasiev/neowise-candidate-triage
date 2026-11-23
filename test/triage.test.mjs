import test from "node:test";
import assert from "node:assert/strict";
import {
  InvalidInputError,
  parseInput,
  parseModelOutput,
  triage,
} from "../triage.mjs";
import { createApp } from "../server.mjs";

const MANUAL = { status: "manual_review", topic: null, draft: null };

async function withServer(t) {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function post(base, body) {
  return fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

test("parseInput rejects empty, whitespace, non-string and broken JSON", () => {
  for (const body of [
    "",
    "   ",
    "not json",
    "{}",
    '{"text":""}',
    '{"text":"   "}',
    '{"text":42}',
    '{"text":null}',
    "null",
    "[]",
    '"text"',
  ]) {
    assert.throws(() => parseInput(body), InvalidInputError, `body=${JSON.stringify(body)}`);
  }
});

test("parseInput returns trimmed text", () => {
  assert.equal(parseInput('{"text":"  когда доставка?  "}'), "когда доставка?");
});

test("parseModelOutput rejects bad json, unknown topic and empty draft", () => {
  assert.equal(parseModelOutput("not json"), null);
  assert.equal(parseModelOutput('{"topic":"refund","draft":"ok"}'), null);
  assert.equal(parseModelOutput('{"topic":"other","draft":"   "}'), null);
  assert.equal(parseModelOutput('{"topic":"other"}'), null);
  assert.deepEqual(parseModelOutput('{"topic":"delivery","draft":"  ok  "}'), {
    topic: "delivery",
    draft: "ok",
  });
});

test("valid text -> ready", async () => {
  const result = await triage("Когда будет доставка?");
  assert.equal(result.status, "ready");
  assert.equal(result.topic, "delivery");
  assert.ok(result.draft.trim().length > 0);
});

test("model failure scenarios -> manual_review", async () => {
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    assert.deepEqual(await triage(`заявка ${marker}`), MANUAL, marker);
  }
});

test("timeout is bounded by 300ms and gives manual_review", async () => {
  const started = Date.now();
  const result = await triage("[timeout]");
  const elapsed = Date.now() - started;
  assert.deepEqual(result, MANUAL);
  assert.ok(elapsed < 1_000, `triage took ${elapsed}ms`);
});

test("HTTP: empty and broken JSON -> 400 invalid_input", async (t) => {
  const base = await withServer(t);

  for (const body of ["", "{oops", '{"text":"   "}', '{"text":42}']) {
    const response = await post(base, body);
    assert.equal(response.status, 400, `body=${JSON.stringify(body)}`);
    assert.deepEqual(await response.json(), { status: "invalid_input" });
  }
});

test("HTTP: valid input -> 200 ready; model failure -> 200 manual_review", async (t) => {
  const base = await withServer(t);

  const ready = await post(base, JSON.stringify({ text: "Какая цена?" }));
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.status, "ready");
  assert.equal(readyBody.topic, "pricing");
  assert.ok(readyBody.draft.trim().length > 0);

  const failed = await post(base, JSON.stringify({ text: "заявка [error]" }));
  assert.equal(failed.status, 200);
  assert.deepEqual(await failed.json(), MANUAL);
});
