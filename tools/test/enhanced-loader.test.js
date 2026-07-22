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

test('Enhanced Node resources use the stable Varde player-list API', () => {
  for (const resourceName of nodeResources) {
    const main = fs.readFileSync(
      path.join(resourceRoot, resourceName, 'server', 'main.js'),
      'utf8',
    );

    assert.doesNotMatch(main, /(^|[^.\w])GetPlayers\(/mu, resourceName);
  }
});

test('client RPC accepts serialized Cfx callback references', () => {
  const client = fs.readFileSync(
    path.join(resourceRoot, 'varde_core', 'client', 'main.lua'),
    'utf8',
  );

  assert.match(client, /local function isCallable\(value\)/u);
  assert.match(client, /rawget\(metatable, '__call'\)/u);
  assert.match(
    client,
    /assert\(isCallable\(callback\), 'callback must be callable'\)/u,
  );
  assert.doesNotMatch(client, /type\(callback\) == 'function'/u);
});

test('client spawning delegates player creation to the Cfx spawnmanager', () => {
  const client = fs.readFileSync(
    path.join(resourceRoot, 'varde_core', 'client', 'main.lua'),
    'utf8',
  );

  assert.match(client, /exports\.spawnmanager:spawnPlayer\(\{/u);
  assert.match(client, /local function nativeTrue\(value\)/u);
  assert.match(client, /return value == true or value == 1/u);
  assert.match(client, /shutdownLoadingScreens\(\)\s*DoScreenFadeIn\(500\)/u);
  assert.match(client, /GetResourceState\('spawnmanager'\) ~= 'started'/u);
  assert.doesNotMatch(client, /SetPlayerModel\(/u);
  assert.doesNotMatch(client, /NetworkResurrectLocalPlayer\(/u);
  assert.match(client, /SetPlayerControl\(PlayerId\(\), true, false\)/u);
  assert.match(client, /RenderScriptCams\(false, false, 0, true, true\)/u);
  assert.match(client, /TriggerServerEvent\('varde:server:spawnDiagnostics'/u);
  assert.match(client, /DoScreenFadeIn\(500\)/u);
  assert.match(client, /ShutdownLoadingScreen\(\)/u);
  assert.match(client, /ShutdownLoadingScreenNui\(\)/u);
  assert.match(client, /SetTimeout\(15000,/u);
  assert.match(
    client,
    /if response\.ok and response\.data then[\s\n]*loadPlayer\(response\.data\)/u,
  );
});

test('fullscreen Varde NUI pages keep the Enhanced CEF canvas transparent', () => {
  for (const resourceName of ['varde_identity', 'varde_admin', 'varde_phone']) {
    const page = fs.readFileSync(
      path.join(resourceRoot, resourceName, 'web', 'index.html'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(resourceRoot, resourceName, 'web', 'styles.css'),
      'utf8',
    );

    assert.match(
      styles,
      /html,\s*body\s*\{\s*background-color:\s*transparent\s*!important;/u,
      resourceName,
    );
    assert.doesNotMatch(page, /<meta\s+name="color-scheme"/u, resourceName);
  }
});

test('identity closes its NUI before handling the spawn request', () => {
  const client = fs.readFileSync(
    path.join(resourceRoot, 'varde_identity', 'client.lua'),
    'utf8',
  );

  assert.match(client, /local function releaseNuiFocus\(\)/u);
  assert.match(client, /SetNuiFocusKeepInput\(false\)/u);
  assert.match(
    client,
    /AddEventHandler\('varde_identity:client:spawnRequested',[\s\S]*?closeMenu\(\)[\s\S]*?exports\.varde_core:SpawnAt/u,
  );
});

test('cross-resource client lifecycle handlers are network-safe', () => {
  const consumers = {
    varde_identity: ['varde:client:playerLoggedOut'],
  };

  for (const [resourceName, eventNames] of Object.entries(consumers)) {
    const client = fs.readFileSync(
      path.join(resourceRoot, resourceName, 'client.lua'),
      'utf8',
    );

    for (const eventName of eventNames) {
      assert.match(
        client,
        new RegExp(`RegisterNetEvent\\('${eventName.replace(':', '\\:')}'`),
        `${resourceName}: ${eventName}`,
      );
    }
  }
});
