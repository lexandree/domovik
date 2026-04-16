"use strict";

const assert = require("assert/strict");
const {
  normalizePrompt,
  isCodexTriggered,
  shouldAttachScreens,
  removeCodexTrigger,
  isClaudeCodeTriggered,
  removeClaudeCodeTrigger,
  isOpenClawTriggered,
  removeOpenClawTrigger,
  parseKeyterms
} = require("../server.js");

const codexCases = [
  ["nimm codex räum das repo auf", "räum das repo auf"],
  ["nimm codex mit screen finde den button", "finde den button"],
  ["use codex refactor this file", "refactor this file"],
  ["run codex with screenshot find the submit button", "find the submit button"],
  ["запусти codex почини тесты", "почини тесты"],
  ["передай codex со скриншотом найди ошибку", "найди ошибку"]
];

for (const [input, expectedRemainder] of codexCases) {
  assert.equal(isCodexTriggered(input), true, input);
  assert.equal(removeCodexTrigger(input), expectedRemainder, input);
}

assert.equal(shouldAttachScreens("run codex with screenshot find the button"), true);
assert.equal(shouldAttachScreens("запусти codex со скриншотом найди кнопку"), true);
assert.equal(shouldAttachScreens("use codex refactor this file"), false);

const claudeCodeCases = [
  ["nimm claude code führe das setup weiter", "führe das setup weiter"],
  ["use claude code continue the migration", "continue the migration"],
  ["запусти клауд код допиши документацию", "допиши документацию"]
];

for (const [input, expectedRemainder] of claudeCodeCases) {
  assert.equal(isClaudeCodeTriggered(input), true, input);
  assert.equal(removeClaudeCodeTrigger(input), expectedRemainder, input);
}

const openClawCases = [
  ["nimm openclaw prüf den лог", "prüf den лог"],
  ["send openclaw inspect the output", "inspect the output"],
  ["передай клаус проверь результат", "проверь результат"]
];

for (const [input, expectedRemainder] of openClawCases) {
  assert.equal(isOpenClawTriggered(input), true, input);
  assert.equal(removeOpenClawTrigger(input), expectedRemainder, input);
}

assert.equal(normalizePrompt("запусти клауд код"), "запусти claude code");
assert.equal(normalizePrompt("передай клаус"), "передай openclaw");
assert.deepEqual(
  parseKeyterms("Codex, Claude Code, OpenClaw", []),
  ["Codex", "Claude Code", "OpenClaw"]
);

console.log("trigger normalization tests passed");
