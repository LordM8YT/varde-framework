'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const resourceRoot = path.join(root, 'resources', '[varde]');

const nodeResources = [
  'varde_core',
  'varde_jobs',
  'varde_inventory',
  'varde_admin',
  'varde_phone',
];

test('Enhanced Node resources enter CommonJS through a root loader', () => {
  for (const resourceName of nodeResources) {
    const resourcePath = path.join(resourceRoot, resourceName);
    const manifest = fs.readFileSync(
      path.join(resourcePath, 'fxmanifest.lua'),
      'utf8',
    );
    const loader = fs.readFileSync(path.join(resourcePath, 'server.js'), 'utf8');

    assert.match(manifest, /^node_version '26'$/mu, resourceName);
    assert.match(manifest, /^server_script 'server\.js'$/mu, resourceName);
    assert.doesNotMatch(
      manifest,
      /^server_script 'server\/main\.js'$/mu,
      resourceName,
    );
    assert.equal(loader, "'use strict';\n\nrequire('./server/main');\n");
  }
});

test('CommonJS modules call the Cfx export registrar explicitly', () => {
  for (const resourceName of nodeResources) {
    const main = fs.readFileSync(
      path.join(resourceRoot, resourceName, 'server', 'main.js'),
      'utf8',
    );

    assert.doesNotMatch(main, /(^|[^.\w])exports(?:\.|\()/mu, resourceName);
    assert.match(main, /globalThis\.exports\(/u, resourceName);
  }
});
