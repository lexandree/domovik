"use strict";

const assert = require("assert/strict");
const { shouldGuardMissingCurrentVisualContext } = require("../server.js");

assert.equal(
  shouldGuardMissingCurrentVisualContext("What do you see on the picture?"),
  true
);
assert.equal(
  shouldGuardMissingCurrentVisualContext("Что ты видишь на картинке?"),
  true
);
assert.equal(
  shouldGuardMissingCurrentVisualContext("Describe the screenshot."),
  true
);

assert.equal(
  shouldGuardMissingCurrentVisualContext("What was on the previous screenshot?"),
  false
);
assert.equal(
  shouldGuardMissingCurrentVisualContext("Что было на предыдущей картинке?"),
  false
);
assert.equal(
  shouldGuardMissingCurrentVisualContext("Расскажи про предыдущий скриншот."),
  false
);

console.log("visual context guard tests passed");
