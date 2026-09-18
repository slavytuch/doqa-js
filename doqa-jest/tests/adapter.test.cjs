const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");
const root = path.resolve(__dirname, "../../dist/doqa-jest");
const jest = require.resolve("jest/bin/jest");

async function run(t, sources, options = {}, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doqa-jest-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(sources))
    fs.writeFileSync(path.join(dir, file), source);
  fs.writeFileSync(
    path.join(dir, "jest.config.cjs"),
    `const {withDoqa}=require(${JSON.stringify(root + "/src")});module.exports=withDoqa(${JSON.stringify({ rootDir: dir, testMatch: ["**/*.test.cjs", "**/*.test.mjs"], maxWorkers: 2, ...config })},${JSON.stringify({ reporting: "files", resultsDir: path.join(dir, "results"), ...options })});`,
  );
  const env = { ...process.env, NODE_OPTIONS: "--experimental-vm-modules" };
  delete env.NODE_TEST_CONTEXT;
  for (const key of Object.keys(env))
    if (key.startsWith("DOQA_")) delete env[key];
  const processResult = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [jest, "--config", path.join(dir, "jest.config.cjs"), "--no-cache"],
      { cwd: dir, env },
    );
    let output = "";
    child.stdout.on("data", (s) => (output += s));
    child.stderr.on("data", (s) => (output += s));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
  const results = fs.existsSync(path.join(dir, "results"))
    ? fs
        .readdirSync(path.join(dir, "results"))
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, "results", f))))
    : [];
  const sessions = fs.existsSync(path.join(dir, ".doqa"))
    ? fs.readdirSync(path.join(dir, ".doqa"))
    : [];
  return { ...processResult, dir, results, sessions };
}
const api = `const {doqa}=require(${JSON.stringify(root + "/src")});\n`;
async function server(t, plan = []) {
  const calls = [];
  const service = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = req.headers["content-type"]?.includes("application/json")
      ? JSON.parse(body)
      : {};
    const url = new URL(req.url, "http://localhost");
    calls.push({ path: url.pathname, body: json, url });
    res.setHeader("Content-Type", "application/json");
    if (url.pathname.endsWith("/autotests") && req.method === "GET")
      return res.end(JSON.stringify({ autotests: plan }));
    if (url.pathname.endsWith("/test-runs")) return res.end('{"runId":42}');
    if (url.pathname.endsWith("/attachments"))
      return res.end('{"mediaFileId":7}');
    if (url.pathname.endsWith("/results"))
      return res.end(
        JSON.stringify({ accepted: json.results.length, elementIds: [] }),
      );
    res.end('{"map":{}}');
  });
  await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => service.close(resolve)));
  return {
    calls,
    options: {
      reporting: "api",
      url: `http://127.0.0.1:${service.address().port}`,
      spaceId: 1,
      token: "test-secret",
      retries: 0,
    },
  };
}

test("ordinary tests, nested steps, hooks, attachments, todo and failure", async (t) => {
  const result = await run(t, {
    "sample.test.cjs":
      api +
      `
    beforeAll(()=>doqa.step('suite setup',()=>{}));
    beforeEach(()=>doqa.step('setup',()=>{}));
    afterAll(()=>doqa.step('suite cleanup',()=>{}));
    doqa.test('success',{id:'DOQA-1',caseIds:[12]},async()=>{
      await doqa.step('outer',async()=>{doqa.step('inner',()=>doqa.attach('text','hello'));});
    });
    test('failure',()=>expect(1).toBe(2));test.skip('skip',()=>{});test.todo('todo');
  `,
  });
  assert.equal(result.code, 1, result.output);
  assert.equal(result.results.length, 4, result.output);
  const success = result.results.find((r) => r.name === "success");
  assert.equal(success.steps[0].steps[0].attachments.length, 1);
  assert.equal(
    fs.readFileSync(
      path.join(
        result.dir,
        "results",
        success.steps[0].steps[0].attachments[0].source,
      ),
      "utf8",
    ),
    "hello",
  );
  const container = JSON.parse(
    fs.readFileSync(
      path.join(result.dir, "results", success.uuid + "-container.json"),
    ),
  );
  assert.ok(
    container.befores.some((s) =>
      s.steps.some((c) => c.name === "suite setup"),
    ),
  );
  assert.ok(
    container.befores.some((s) => s.steps.some((c) => c.name === "setup")),
  );
  assert.equal(container.afters.length, 1);
  assert.equal(result.results.filter((r) => r.status === "skipped").length, 2);
});
test("each has one test identity, different histories; retries retain their history", async (t) => {
  const result = await run(t, {
    "each.test.cjs":
      api +
      `
    jest.retryTimes(1);let count=0;
    doqa.test.each([[1],[2]])('row %i',{id:'DATA'},async value=>{doqa.parameter('value',value);});
    doqa.test('retry',{id:'RETRY'},()=>{expect(++count).toBe(2);});
  `,
  });
  assert.equal(result.code, 0, result.output);
  const rows = result.results.filter((r) => r.testCaseId === "DATA");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].historyId, rows[1].historyId);
  const retries = result.results.filter((r) => r.testCaseId === "RETRY");
  assert.equal(retries.length, 2);
  assert.equal(retries[0].historyId, retries[1].historyId);
});
test("non-finite numeric datasets retain distinct parameters and history", async (t) => {
  const result = await run(t, {
    "numbers.test.cjs": api + `
      doqa.test.each([[NaN], [Infinity], [-Infinity], [null], [0], ["NaN"]])(
        'number %s', {id:'NUMBERS'}, value => {
          doqa.parameter('runtime', value);
          expect(true).toBe(true);
        });
    `,
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 6);
  assert.equal(new Set(result.results.map(r => r.historyId)).size, 6);
  const parameters = result.results.map(r => r.parameters.find(p => p.name === 'arg0').value);
  assert.deepEqual(parameters.sort(), ['NaN', 'Infinity', '-Infinity', 'null', '0', '"NaN"'].sort());
  for (const row of result.results) {
    const value = row.parameters.find(p => p.name === 'arg0').value;
    assert.equal(row.parameters.find(p => p.name === 'runtime').value, value === '"NaN"' ? 'NaN' : value);
  }
});

test("concurrent and worker contexts cannot share steps or parameters", async (t) => {
  const source =
    api +
    `for(const id of ['A','B']) doqa.test.concurrent(id,{id},async()=>{await doqa.step(id,async()=>{await new Promise(r=>setTimeout(r,id==='A'?30:5));doqa.parameter('owner',id);doqa.attach(id,id);});});`;
  const result = await run(t, {
    "parallel.test.cjs": source,
    "worker.test.cjs":
      api + `doqa.test('C',{id:'C'},()=>doqa.step('C',()=>{}));`,
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 3);
  for (const r of result.results) assert.equal(r.steps[0].name, r.testCaseId);
});
test("direct API creates one run and uses one completion tuple across workers", async (t) => {
  const fake = await server(t);
  const result = await run(
    t,
    {
      "a.test.cjs": api + `doqa.test('A',{id:'A'},()=>doqa.attach('x','x'));`,
      "b.test.cjs": api + `doqa.test('B',{id:'B'},()=>{});`,
    },
    { ...fake.options, batchSize: 1, importRealtime: true },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(
    fake.calls.filter((c) => c.path.endsWith("/test-runs")).length,
    1,
  );
  const chunks = fake.calls
    .filter((c) => c.path.endsWith("/results"))
    .map((c) => c.body);
  assert.equal(
    chunks.reduce((n, c) => n + c.results.length, 0),
    2,
  );
  assert.equal(new Set(chunks.map((c) => c.report_id)).size, 1);
  assert.deepEqual(
    chunks.map((c) => c.chunk_index),
    chunks.map((_, i) => i),
  );
  assert.equal(chunks.filter((c) => c.is_final_chunk).length, 1);
  assert.ok(chunks.at(-1).is_final_chunk);
  assert.ok(chunks.every((c) => c.test_run_id === 42));
});
test("selective mode never executes excluded callbacks or beforeEach", async (t) => {
  const fake = await server(t, [{ externalId: "YES" }]);
  const result = await run(
    t,
    {
      "select.test.cjs":
        api +
        `
    let hooks=0;beforeEach(()=>hooks++);afterAll(()=>expect(hooks).toBe(1));
    doqa.test('selected',{id:'YES'},()=>{});
    doqa.test('excluded',{id:'NO'},()=>{throw new Error('should not execute')});
  `,
    },
    { ...fake.options, testRunId: 42, adapterMode: 0 },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].testCaseId, "YES");
});
test("valid empty plan executes no tests", async (t) => {
  const fake = await server(t, []);
  const result = await run(
    t,
    {
      "empty.test.cjs":
        api +
        `beforeAll(()=>{throw new Error('suite must not execute')});doqa.test('x',{id:'X'},()=>{throw new Error('must not execute')});`,
    },
    { ...fake.options, testRunId: 42, adapterMode: 0 },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 0);
});
test("network failure preserves Jest status and local recovery data", async (t) => {
  const result = await run(
    t,
    { "offline.test.cjs": api + `doqa.test('x',{id:'X'},()=>{});` },
    {
      reporting: "api",
      url: "http://127.0.0.1:1",
      token: "SECRET-NOT-LOGGED",
      spaceId: 1,
      retries: 0,
      requestTimeoutMs: 100,
    },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 1);
  assert.match(result.output, /recovery files/);
  assert.ok(!result.output.includes("SECRET-NOT-LOGGED"));
});
test("ESM test imports typed package exports", async (t) => {
  const result = await run(t, {
    "esm.test.mjs": `import {doqa} from ${JSON.stringify(root + "/src/index.mjs")};doqa.test('esm',{id:'ESM'},()=>doqa.step('once',()=>{}));`,
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results[0].steps.length, 1);
});
test("jsdom environment keeps browser APIs", async (t) => {
  const result = await run(
    t,
    {
      "dom.test.cjs":
        api +
        `doqa.test('dom',{id:'DOM'},()=>expect(document.createElement('p').tagName).toBe('P'));`,
    },
    {},
    { testEnvironment: "jsdom" },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 1);
});
test("strict plan order within suite", async (t) => {
  const fake = await server(t, [
    { externalId: "B", namespace: "order.test.cjs" },
    { externalId: "A", namespace: "order.test.cjs" },
  ]);
  const result = await run(
    t,
    {
      "order.test.cjs":
        api +
        `const seen=[];doqa.test('A',{id:'A'},()=>{seen.push('A')});doqa.test('B',{id:'B'},()=>{seen.push('B')});afterAll(()=>expect(seen).toEqual(['B','A']));`,
    },
    { ...fake.options, testRunId: 42, adapterMode: 0, executionOrder: "plan" },
  );
  assert.equal(result.code, 0, result.output);
});
test("hook errors and file load failures produce broken results", async (t) => {
  const result = await run(t, {
    "hook.test.cjs":
      api +
      `beforeEach(()=>{throw new Error('setup failed')});doqa.test('hook',{id:'HOOK'},()=>{});`,
    "load.test.cjs": `throw new Error('load failed');`,
  });
  assert.equal(result.code, 1, result.output);
  assert.equal(result.results.length, 2, result.output);
  assert.ok(result.results.every((r) => r.status === "broken"));
});
test("off has no reporting and does not duplicate step callbacks", async (t) => {
  const result = await run(
    t,
    {
      "off.test.cjs":
        api +
        `test('off',()=>{let n=0;doqa.step('once',()=>{n++});expect(n).toBe(1)});`,
    },
    { reporting: "off" },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 0);
});

test("TypeScript transforms are preserved", async (t) => {
  const result = await run(
    t,
    {
      "typed.test.cjs":
        api +
        `const value: number = 7;doqa.test('typed',{id:'TS'},()=>expect(value).toBe(7));`,
      "transform.cjs": `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports={process(source){return {code:ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText};}};`,
    },
    {},
    { transform: { "^.+\\.test\\.cjs$": "<rootDir>/transform.cjs" } },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results[0].testCaseId, "TS");
});
test("unavailable plan is fail-open; title ids use the common DoQA syntax", async (t) => {
  const result = await run(
    t,
    { "fallback.test.cjs": `test('[DOQA:17] title',()=>{});` },
    {
      reporting: "files",
      url: "http://127.0.0.1:1",
      token: "secret",
      spaceId: 1,
      testRunId: 42,
      adapterMode: 0,
      retries: 0,
    },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results[0].testCaseId, "DOQA-17");
  assert.match(result.output, /Cannot load test plan/);
});
test("strict order rejects interleaved describe blocks", async (t) => {
  const fake = await server(
    t,
    ["A", "B", "C"].map((externalId) => ({
      externalId,
      namespace: "order.test.cjs",
    })),
  );
  const result = await run(
    t,
    {
      "order.test.cjs":
        api +
        `describe('one',()=>{doqa.test('A',{id:'A'},()=>{});doqa.test('C',{id:'C'},()=>{});});describe('two',()=>{doqa.test('B',{id:'B'},()=>{});});`,
    },
    { ...fake.options, testRunId: 42, adapterMode: 0, executionOrder: "plan" },
  );
  assert.equal(result.code, 1);
  assert.match(result.output, /interleaves describe blocks/);
});
test("ordinary callback-style Jest tests retain done semantics", async (t) => {
  const result = await run(t, {
    "done.test.cjs": `test('callback',done=>{setTimeout(done,5)});`,
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results[0].status, "passed");
});

test("multiple Jest projects share a run and separate fallback identities", async (t) => {
  const fake = await server(t);
  const result = await run(
    t,
    {
      "one.test.cjs": "test('same name',()=>{});",
      "two.test.cjs": "test('same name',()=>{});",
    },
    fake.options,
    {
      projects: [
        { displayName: "one", testMatch: ["**/one.test.cjs"] },
        { displayName: "two", testMatch: ["**/two.test.cjs"] },
      ],
    },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 2, result.output);
  assert.equal(new Set(result.results.map((r) => r.testCaseId)).size, 2);
  assert.equal(
    fake.calls.filter((c) => c.path.endsWith("/test-runs")).length,
    1,
  );
});

test("custom environment keeps its event handler", async (t) => {
  const result = await run(
    t,
    {
      "custom.cjs": `const {TestEnvironment}=require(${JSON.stringify(require.resolve("jest-environment-node"))});const {wrapEnvironment}=require(${JSON.stringify(root + "/src")});class Custom extends TestEnvironment {async setup(){await super.setup();this.global.customEvents=0;} handleTestEvent(e){if(e.name==='test_start')this.global.customEvents++;}}module.exports=wrapEnvironment(Custom);`,
      "custom.test.cjs":
        api +
        `doqa.test('custom',{id:'CUSTOM'},()=>expect(customEvents).toBe(1));`,
    },
    {},
    { testEnvironment: "<rootDir>/custom.cjs" },
  );
  assert.equal(result.code, 0, result.output);
  assert.equal(result.results.length, 1);
});
