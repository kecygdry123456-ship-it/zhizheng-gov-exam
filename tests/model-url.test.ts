import assert from "node:assert/strict";
import { test } from "node:test";
import type { lookup } from "node:dns/promises";
import { normalizeModelBaseUrl } from "../src/lib/model-url";

test("MODEL-URL-001: DNS lookup obeys the shared model deadline", async () => {
  const neverResolvingLookup = (() =>
    new Promise(() => undefined)) as unknown as typeof lookup;
  const startedAt = Date.now();
  await assert.rejects(
    normalizeModelBaseUrl("https://slow-dns.example/v1", {
      deadlineAt: startedAt + 60,
      lookupHost: neverResolvingLookup,
    }),
    /解析超时/,
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 30, `lookup returned too early after ${elapsed}ms`);
  assert.ok(elapsed < 500, `lookup exceeded its deadline after ${elapsed}ms`);
});

test("MODEL-URL-002: an expired deadline prevents DNS from starting", async () => {
  let calls = 0;
  const lookupSpy = (() => {
    calls += 1;
    return Promise.resolve([{ address: "8.8.8.8", family: 4 }]);
  }) as unknown as typeof lookup;
  await assert.rejects(
    normalizeModelBaseUrl("https://deadline-expired.example/v1", {
      deadlineAt: Date.now() - 1,
      lookupHost: lookupSpy,
    }),
    /校验超时/,
  );
  assert.equal(calls, 0);
});
