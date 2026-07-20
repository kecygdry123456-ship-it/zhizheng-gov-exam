import assert from "node:assert/strict";
import { test } from "node:test";
import {
  repairedDirectImageStem,
  sha256,
  verifyAlreadyRepairedDirectImageCandidate,
  verifyDirectImageCandidate,
  type DirectImageQuestion,
} from "../scripts/repair-missing-direct-question-images";

function png(width: number, height: number, length: number) {
  const buffer = Buffer.alloc(length);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const question: DirectImageQuestion = {
  externalKey: "gkzhenti:1716870708295:61",
  status: "PUBLISHED",
  stem: '<img src="/question-images/03/037272f240277cb77093c314.png" class="inline-img">',
  options: ["8", "10", "12", "14"],
  answer: 2,
};

test("direct image repair keeps the existing diagram after the missing formula", () => {
  const repaired = repairedDirectImageStem(question.stem);
  assert.match(repaired, /290633f68ae9564a/);
  assert.ok(repaired.endsWith(question.stem));
});

test("direct image repair rejects an unapproved question before hash checks", () => {
  const result = verifyDirectImageCandidate(
    { ...question, externalKey: "gkzhenti:1716870708295:62" },
    png(481, 260, 32),
    png(67, 20, 32),
    png(481, 260, 32),
  );
  assert.deepEqual(result, { ok: false, reason: "not-approved" });
});

test("direct image repair rejects changed options before hash checks", () => {
  const result = verifyDirectImageCandidate(
    { ...question, options: ["8", "10", "12", "16"] },
    png(481, 260, 32),
    png(67, 20, 32),
    png(481, 260, 32),
  );
  assert.deepEqual(result, { ok: false, reason: "answer-or-options-mismatch" });
});

test("direct image repair is idempotent after a successful update", () => {
  const formula = png(67, 20, 32);
  const diagram = png(481, 260, 32);
  const repaired = { ...question, stem: repairedDirectImageStem(question.stem) };
  assert.deepEqual(verifyAlreadyRepairedDirectImageCandidate(repaired, formula, diagram, {
    formula: sha256(formula),
    diagram: sha256(diagram),
  }), { ok: true });
});
