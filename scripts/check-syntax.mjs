import { readdir } from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';

const root = process.cwd();
const targets = ['src', 'scripts'];
const files = [];

// Recursively collects JavaScript files that should pass node --check.
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      files.push(fullPath);
    }
  }
}

for (const target of targets) {
  await walk(path.join(root, target));
}

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  });
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`Checked ${files.length} JavaScript files.`);
