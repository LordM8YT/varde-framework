'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FrameworkDatabase } = require('../server/database');
const { CoreService } = require('../server/service');

function createHarness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-service-'));
  const database = new FrameworkDatabase(path.join(directory, 'test.sqlite'));
  const events = [];
  const states = [];
  const logs = [];
  const runtime = {
    emitClient(source, eventName, ...args) {
      events.push({ source, eventName, args });
    },
    setPlayerState(source, key, value, replicated) {
      states.push({ source, key, value, replicated });
    },
    log(level, message) {
      logs.push({ level, message });
    },
  };
  const config = {
    maxCharacters: 4,
    startingMoney: { cash: 500, bank: 5000 },
    defaultJob: {
      name: 'unemployed',
      label: 'Unemployed',
      grade: 0,
      onDuty: false,
    },
    defaultSpawn: { x: 1, y: 2, z: 3, heading: 90 },
  };
  const service = new CoreService(database, config, runtime);

  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { service, events, states, logs };
}

test('account, character, login, mutation, and logout form one lifecycle', (t) => {
  const { service, events, states } = createHarness(t);
  service.attachConnection(
    12,
    'license2:lifecycle',
    ['license2:lifecycle', 'fivem:12'],
    'Lifecycle Test',
  );

  const created = service.createCharacter(12, {
    slot: 1,
    firstName: 'Kari',
    lastName: 'Nordmann',
    birthDate: '1995-06-15',
    gender: 'unspecified',
    nationality: 'Norwegian',
  });
  const selected = service.selectCharacter(12, created.characterId);

  assert.equal(selected.money.cash, 500);
  assert.equal(service.getPlayerData(12).characterId, created.characterId);
  assert.equal(service.getPlayerData(created.characterId).profile.firstName, 'Kari');
  assert.equal(
    events.some((event) => event.eventName === 'varde:client:playerLoaded'),
    true,
  );
  assert.equal(
    states.some(
      (state) =>
        state.key === 'varde:loaded' &&
        state.value === true &&
        state.replicated === true,
    ),
    true,
  );

  assert.equal(
    service.changeMoney(12, 'cash', 200, 'add', 'test', null, 'unit-test'),
    700,
  );
  assert.deepEqual(
    service.setMetadata(12, 'licenses.driving', { granted: true }),
    { granted: true },
  );
  service.updatePosition(12, { x: 10, y: 20, z: 30, heading: 370 });
  assert.equal(service.getPlayerData(12).position.heading, 10);

  assert.equal(service.logout(12), true);
  assert.equal(service.getPlayerData(12), null);
  assert.equal(
    states.some(
      (state) => state.key === 'varde:loaded' && state.value === false,
    ),
    true,
  );
});

test('the same Rockstar account cannot connect twice', (t) => {
  const { service } = createHarness(t);
  service.attachConnection(1, 'license2:same', ['license2:same'], 'First');
  assert.throws(
    () => service.attachConnection(2, 'license2:same', ['license2:same'], 'Second'),
    { code: 'ALREADY_CONNECTED' },
  );
});

test('character deletion requires ownership and exact confirmation', (t) => {
  const { service } = createHarness(t);
  service.attachConnection(7, 'license2:delete', ['license2:delete'], 'Delete');
  const created = service.createCharacter(7, {
    slot: 1,
    firstName: 'Delete',
    lastName: 'Candidate',
    birthDate: '1990-01-01',
    gender: 'unspecified',
    nationality: 'Norwegian',
  });

  const bootstrap = service.characterBootstrap(7);
  assert.equal(bootstrap.maxCharacters, 4);
  assert.equal(bootstrap.characters.length, 1);
  assert.throws(
    () => service.deleteCharacter(7, created.characterId, 'wrong'),
    { code: 'DELETE_CONFIRMATION_REQUIRED' },
  );
  assert.equal(
    service.deleteCharacter(7, created.characterId, created.characterId),
    true,
  );
  assert.equal(service.listCharacters(7).length, 0);
});
