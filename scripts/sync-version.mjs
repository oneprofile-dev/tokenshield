#!/usr/bin/env node
/**
 * Single source of truth for TokenShield versions.
 *
 * Reads version.txt from the repo root and stamps it into:
 *   - package.json (root)
 *   - packages/core/package.json
 *   - packages/cli/package.json  (+ @curatedmcp/tokenshield-core dependency)
 *   - packages/cli/src/cli.ts    (VERSION constant)
 *
 * Usage:
 *   node scripts/sync-version.mjs          # use version.txt
 *   node scripts/sync-version.mjs 2.0.0    # override for one-off bump
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
const version = arg ?? readFileSync(resolve(root, "version.txt"), "utf8").trim();

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Invalid version: "${version}"`);
  process.exit(1);
}

function patchJson(path, fn) {
  const raw = readFileSync(path, "utf8");
  const obj = JSON.parse(raw);
  fn(obj);
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
  console.log(`  updated ${path.replace(root + "/", "")}`);
}

console.log(`\nSyncing version → ${version}\n`);

patchJson(resolve(root, "package.json"), (pkg) => {
  pkg.version = version;
});

patchJson(resolve(root, "packages/core/package.json"), (pkg) => {
  pkg.version = version;
});

patchJson(resolve(root, "packages/cli/package.json"), (pkg) => {
  pkg.version = version;
  if (pkg.dependencies?.["@curatedmcp/tokenshield-core"]) {
    pkg.dependencies["@curatedmcp/tokenshield-core"] = `^${version}`;
  }
});

const cliTs = resolve(root, "packages/cli/src/cli.ts");
const src = readFileSync(cliTs, "utf8");
const patched = src.replace(
  /^const VERSION = "[^"]+";/m,
  `const VERSION = "${version}";`
);
if (src === patched) {
  console.warn("  WARN: VERSION constant not found in cli.ts — check manually");
} else {
  writeFileSync(cliTs, patched);
  console.log("  updated packages/cli/src/cli.ts");
}

// Keep version.txt in sync with whatever version was used
writeFileSync(resolve(root, "version.txt"), version + "\n");

console.log(`\nDone. Run 'npm install' if you changed workspace dependency versions.\n`);
