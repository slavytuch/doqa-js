const { test } = require("node:test");
const assert = require("node:assert/strict");

test("environment plan order also configures the Jest scheduler", () => {
  const { withDoqa } = require("../../dist/doqa-jest/src");
  const previous = process.env.DOQA_EXECUTION_ORDER;
  process.env.DOQA_EXECUTION_ORDER = "plan";
  try {
    const config = withDoqa({}, { reporting: "files" });
    assert.equal(config.maxWorkers, 1);
    assert.match(config.testSequencer, /sequencer\.js$/);
  } finally {
    if (previous === undefined) delete process.env.DOQA_EXECUTION_ORDER;
    else process.env.DOQA_EXECUTION_ORDER = previous;
  }
});
