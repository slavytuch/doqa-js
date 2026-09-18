const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveConfig } = require("../../dist/doqa-js-commons/src");

test("configuration validates numbers and infers an existing run", () => {
  const config = resolveConfig({ reporting: "files", testRunId: 42 });
  assert.equal(config.adapterMode, 1);
  assert.throws(() => resolveConfig({ batchSize: 0 }), /batchSize/);
  assert.throws(
    () => resolveConfig({ reporting: "api", token: "" }),
    /requires/,
  );
});
