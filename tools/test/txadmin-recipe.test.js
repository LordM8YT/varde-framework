'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const recipe = fs.readFileSync(path.join(root, 'recipe.yaml'), 'utf8');
const serverConfig = fs.readFileSync(
  path.join(root, 'txadmin', 'server.cfg'),
  'utf8',
);

function indexOfLine(value, line) {
  return value.split(/\r?\n/u).findIndex((candidate) => candidate.trim() === line);
}

test('txAdmin recipe installs a complete dependency-free Varde server', () => {
  assert.match(recipe, /^\$engine: 3$/mu);
  assert.match(recipe, /^\$onesync: on$/mu);
  assert.match(recipe, /^name: Varde Framework$/mu);
  assert.match(recipe, /src: https:\/\/github\.com\/LordM8YT\/varde-framework/u);
  assert.match(recipe, /ref: main/u);
  assert.match(recipe, /src: \.\/tmp\/varde\/resources\/\[varde\]/u);
  assert.match(recipe, /dest: \.\/resources\/\[varde\]/u);
  assert.match(recipe, /src: \.\/tmp\/varde\/LICENSE/u);
  assert.match(recipe, /dest: \.\/resources\/\[varde\]\/LICENSE/u);
  assert.match(recipe, /src: https:\/\/github\.com\/citizenfx\/cfx-server-data/u);
  assert.match(recipe, /ref: e265cb251c88260533c847d4a1a2838c7d828a66/u);
  assert.match(recipe, /subpath: resources/u);
  assert.match(recipe, /path: \.\/tmp\s*$/mu);
  assert.doesNotMatch(recipe, /qbox|qbcore|esx|oxmysql/iu);
});

test('generated server config exposes every txAdmin placeholder', () => {
  for (const placeholder of [
    '{{serverEndpoints}}',
    '{{maxClients}}',
    '{{svLicense}}',
    '{{addPrincipalsMaster}}',
  ]) {
    assert.ok(serverConfig.includes(placeholder), `${placeholder} is missing`);
  }

  assert.doesNotMatch(serverConfig, /^set onesync on$/mu);
  assert.match(serverConfig, /^set sv_stateBagStrictMode true$/mu);
  assert.match(serverConfig, /^set sv_devMode true$/mu);
  assert.doesNotMatch(serverConfig, /^set sv_devmode true$/mu);
  assert.doesNotMatch(serverConfig, /^sv_enforceGameBuild\s+/mu);
  assert.match(serverConfig, /^add_ace group\.admin varde\.admin allow$/mu);
  assert.match(
    serverConfig,
    /^add_ace group\.admin varde\.jobs\.manage allow$/mu,
  );
  assert.match(
    serverConfig,
    /^add_ace group\.admin varde\.vehicles\.manage allow$/mu,
  );
});

test('Varde resources start after core in dependency order', () => {
  const expected = [
    'ensure varde_core',
    'ensure varde_status',
    'ensure varde_jobs',
    'ensure varde_inventory',
    'ensure varde_vehicles',
    'ensure varde_appearance',
    'ensure varde_admin',
    'ensure varde_phone',
    'ensure varde_identity',
    'ensure varde_example',
  ];

  const indexes = expected.map((line) => indexOfLine(serverConfig, line));
  assert.ok(indexes.every((index) => index >= 0), 'a Varde resource is missing');
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
  assert.equal(indexOfLine(serverConfig, 'ensure basic-gamemode'), -1);
  assert.equal(indexOfLine(serverConfig, 'stop basic-gamemode'), -1);
});
