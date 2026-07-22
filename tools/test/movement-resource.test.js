'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const resource = path.join(root, 'resources', '[varde]', 'varde_movement');
const manifest = fs.readFileSync(path.join(resource, 'fxmanifest.lua'), 'utf8');
const client = fs.readFileSync(path.join(resource, 'client.lua'), 'utf8');
const generatedConfig = fs.readFileSync(
  path.join(root, 'txadmin', 'server.cfg'),
  'utf8',
);

test('movement remains a standalone optional Varde resource', () => {
  assert.match(manifest, /^name 'varde_movement'$/mu);
  assert.match(manifest, /^dependency 'varde_core'$/mu);
  assert.match(manifest, /^client_script 'client\.lua'$/mu);
  assert.match(generatedConfig, /^setr varde_movement_enabled true$/mu);
  assert.match(generatedConfig, /^ensure varde_movement$/mu);
});

test('movement uses one state-aware dynamic client thread', () => {
  assert.equal((client.match(/CreateThread\(/gu) || []).length, 1);
  assert.match(client, /local sleep = 500/u);
  assert.match(client, /isUsableOnFootPed\(ped\)[\s\S]*?sleep = 0/u);
  assert.match(client, /playerState\['varde:loaded'\]/u);
  assert.match(
    client,
    /RegisterNetEvent\('varde:client:playerLoaded'/u,
  );
  assert.match(
    client,
    /RegisterNetEvent\('varde:client:playerLoggedOut'/u,
  );
});

test('movement implements Enhanced-safe strafe, slide, and vault', () => {
  for (const flag of [128, 241, 427]) {
    assert.match(client, new RegExp(`SetPedConfigFlag\\(ped, ${flag}, `, 'u'));
  }

  assert.match(client, /local function nativeTrue\(value\)/u);
  assert.match(client, /SetEntityHeading\(ped, heading\)/u);
  assert.match(client, /SetPedMoveRateOverride\(ped, Config\.moveRate\)/u);
  assert.doesNotMatch(client, /CreateCam\(/u);
  assert.doesNotMatch(client, /RenderScriptCams\(/u);
  assert.doesNotMatch(client, /SetCamFov\(/u);
  assert.doesNotMatch(client, /SetGameplayCamFov/u);
  assert.match(client, /IsControlJustPressed\(0, INPUT_DUCK\)/u);
  assert.match(client, /SetPedCanRagdoll\(ped, false\)/u);
  assert.match(client, /ApplyForceToEntity\(/u);
  assert.match(client, /slideCooldownUntil/u);
  assert.match(client, /IsPedVaulting\(ped\)/u);
  assert.match(client, /vaultMomentum/u);
});

test('movement restores ped state on shutdown', () => {
  assert.match(client, /originalPedState/u);
  assert.match(client, /for flag, value in pairs\(savedState\.flags\)/u);
  assert.match(client, /AddEventHandler\('onResourceStop'/u);
  assert.match(client, /restorePed\(currentPed\)/u);
  assert.match(
    client,
    /RegisterNetEvent\('varde:client:playerLoggedOut'[\s\S]*?restorePed\(currentPed\)/u,
  );
});
