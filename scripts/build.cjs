const { rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const { workspaces } = require("../package.json");

for (const workspace of workspaces) {
  rmSync(path.join(root, workspace, "dist"), { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, "run", "build", "--workspace", workspace],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
