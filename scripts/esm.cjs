const fs = require("node:fs");
const path = require("node:path");
const names = Object.keys(require(path.resolve("dist/index.js")));
fs.writeFileSync(
  "dist/index.mjs",
  `import api from './index.js';\nexport const {${names.join(", ")}} = api;\n`,
);
