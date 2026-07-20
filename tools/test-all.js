'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
let failures = 0;

function run(command, args, cwd = root, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error || result.status !== 0) {
    failures += 1;
    console.error(
      `[test-all] failed: ${command} ${args.join(' ')}${
        result.error ? ` (${result.error.message})` : ''
      }`,
    );
  }
  return result;
}

function walk(directory, predicate, output = []) {
  if (!fs.existsSync(directory)) {
    return output;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, predicate, output);
    } else if (predicate(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

const resourceRoot = path.join(root, 'resources', '[varde]');
const packages = fs
  .readdirSync(resourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(resourceRoot, entry.name))
  .filter(
    (directory) =>
      fs.existsSync(path.join(directory, 'package.json')) &&
      fs.existsSync(path.join(directory, 'test')),
  )
  .sort();

for (const directory of packages) {
  console.log(`\n[test-all] Node tests: ${path.relative(root, directory)}`);
  run(process.execPath, ['--test'], directory);
}

const toolTests = path.join(root, 'tools', 'test');
if (fs.existsSync(toolTests)) {
  console.log('\n[test-all] Repository tool tests');
  const files = walk(toolTests, (filename) => filename.endsWith('.test.js'));
  run(process.execPath, ['--test', ...files]);
}

const webScripts = walk(resourceRoot, (filename) =>
  filename.endsWith(`${path.sep}web${path.sep}app.js`),
);
for (const filename of webScripts) {
  console.log(`[test-all] JavaScript syntax: ${path.relative(root, filename)}`);
  run(process.execPath, ['--check', filename]);
}

const luaFiles = walk(resourceRoot, (filename) => filename.endsWith('.lua'));
const luacCandidates =
  process.platform === 'win32' ? ['luac.exe', 'luac'] : ['luac5.4', 'luac'];
let luac = null;
for (const candidate of luacCandidates) {
  const probe = spawnSync(candidate, ['-v'], {
    encoding: 'utf8',
    shell: false,
  });
  if (!probe.error) {
    luac = candidate;
    break;
  }
}

if (luac) {
  for (const filename of luaFiles) {
    run(luac, ['-p', filename]);
  }
  console.log(`[test-all] Lua syntax: ${luaFiles.length} file(s)`);
} else if (process.env.VARDE_REQUIRE_LUAC === '1') {
  failures += 1;
  console.error('[test-all] Lua 5.4 compiler is required but was not found.');
} else {
  console.warn('[test-all] Lua compiler not found; Lua syntax check skipped.');
}

if (failures > 0) {
  console.error(`\n[test-all] ${failures} test command(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\n[test-all] All checks passed across ${packages.length} resources.`);
}
