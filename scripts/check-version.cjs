const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const pkg = require("../package.json");
const lock = require("../package-lock.json");
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(
    process.env.GITHUB_REF_NAME,
    `v${pkg.version}`,
    "Tag must match the workspace version",
  );
}
assert.equal(pkg.private, true, "The workspace root must not be published");
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
const packages = pkg.workspaces.map((workspace) => [
  workspace,
  require(path.join(root, workspace, "package.json")),
]);
const names = new Set(packages.map(([, module]) => module.name));
for (const [workspace, module] of packages) {
  assert.equal(
    module.version,
    pkg.version,
    `${workspace}: inconsistent version`,
  );
  assert.equal(
    lock.packages[workspace].version,
    pkg.version,
    `${workspace}: inconsistent lockfile`,
  );
  for (const [name, version] of Object.entries(module.dependencies || {})) {
    if (names.has(name))
      assert.equal(
        version,
        pkg.version,
        `${workspace}: internal dependency ${name}`,
      );
  }
}
console.log(`All ${packages.length} modules match version ${pkg.version}`);
