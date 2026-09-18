const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Client } = require("../../dist/doqa-client/src");

test("safe retries, 429, unsafe POST and redacted errors", async (t) => {
  let status = 503;
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    req.resume();
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end('{"error":"test-secret"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new Client({
    reporting: "api",
    url: `http://127.0.0.1:${server.address().port}`,
    token: "test-secret",
    spaceId: 1,
    retries: 2,
    retryBackoffMs: 0,
    requestTimeoutMs: 30000,
  });
  t.after(async () => {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  });
  await assert.rejects(
    () => client.request("upsert", {}),
    /^Error: DoQA HTTP 503$/,
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(() => client.request("test-runs", {}, "POST", true));
  assert.equal(calls, 3);
  calls = 0;
  status = 429;
  await assert.rejects(() => client.request("results", {}));
  assert.equal(calls, 3);
  calls = 0;
  status = 401;
  await assert.rejects(() => client.request("results", {}, "POST", true));
  assert.equal(calls, 1);
});
