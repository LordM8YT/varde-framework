'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractRoot = path.resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'ui-contracts',
  'v1',
);

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(contractRoot, name), 'utf8'));
}

test('UI v1 mock payloads are parseable and versioned', () => {
  const mocks = [
    fixture('hud.bootstrap.json'),
    fixture('inventory.bootstrap.json'),
    fixture('phone.bootstrap.json'),
  ];

  for (const mock of mocks) {
    assert.match(mock.contract, /^varde\.[a-z]+\.bootstrap\.v1$/u);
  }
});

test('inventory mock uses opaque sides instead of trusted container input', () => {
  const mock = fixture('inventory.bootstrap.json');
  assert.equal(mock.player.type, 'player');
  assert.equal(mock.secondary, null);
  assert.ok(Array.isArray(mock.hotbar));
  assert.equal(mock.capabilities.transfer, false);
});

test('HUD and phone mocks contain only owner-facing public shapes', () => {
  const hud = fixture('hud.bootstrap.json');
  const phone = fixture('phone.bootstrap.json');

  assert.equal(typeof hud.status.hunger, 'number');
  assert.equal(typeof hud.player.money.bank, 'number');
  assert.match(phone.account.phoneNumber, /^\d+$/u);
  assert.equal(phone.conversations[0].lastMessage.readAt, null);
});
