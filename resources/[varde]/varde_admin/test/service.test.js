'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AdminDatabase } = require('../server/database');
const { AdminService } = require('../server/service');

function createHarness(t, granted = ['varde.admin']) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-admin-'));
  const database = new AdminDatabase(path.join(directory, 'admin.sqlite'));
  const players = new Map([
    [
      7,
      {
        characterId: 'vrd_0123456789abcdef',
        profile: { firstName: 'Ada', lastName: 'Admin' },
        job: { name: 'unemployed', label: 'Unemployed', grade: 0 },
      },
    ],
    [
      8,
      {
        characterId: 'vrd_fedcba9876543210',
        profile: { firstName: 'Tara', lastName: 'Target' },
        job: { name: 'police', label: 'Police', grade: 1 },
      },
    ],
  ]);
  const calls = [];
  const integrations = {
    core: {
      getPlayerData(identifier) {
        return players.get(Number(identifier)) || null;
      },
      setMoney(...args) {
        calls.push({ type: 'money', args });
        return { ok: true, data: Number(args[2]) };
      },
    },
    jobs: {
      assignJob(...args) {
        calls.push({ type: 'job', args });
        return { ok: true, data: true };
      },
    },
    inventory: {
      addItem(...args) {
        calls.push({ type: 'item', args });
        return { ok: true, data: true };
      },
    },
  };
  const runtime = {
    isAceAllowed(_source, permission) {
      return granted.includes(permission);
    },
    getPlayers() {
      return [7, 8, 9];
    },
    getPlayerName(source) {
      return `Server ${source}`;
    },
    getPlayerPing(source) {
      return source * 2;
    },
    getPlayerCoordinates(source) {
      return { x: source, y: source + 1, z: source + 2 };
    },
    dropPlayer(source, reason) {
      calls.push({ type: 'kick', args: [source, reason] });
    },
    emitClient(source, eventName, ...args) {
      calls.push({ type: 'event', args: [source, eventName, ...args] });
    },
  };
  const service = new AdminService(database, integrations, runtime);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { service, database, calls };
}

test('bootstrap exposes only selected Varde characters', (t) => {
  const { service } = createHarness(t);
  const bootstrap = service.execute(7, 'bootstrap', {});

  assert.equal(bootstrap.players.length, 2);
  assert.equal(bootstrap.players[1].name, 'Tara Target');
  assert.equal(bootstrap.permissions['varde.admin.economy'], true);
});

test('granular ACE permissions deny unrelated actions and audit denial', (t) => {
  const { service, database } = createHarness(t, [
    'varde.admin.open',
    'varde.admin.players',
  ]);
  assert.equal(service.execute(7, 'bootstrap', {}).players.length, 2);
  assert.throws(
    () => service.execute(7, 'economy:set', {
      target: 8,
      currency: 'cash',
      amount: 100,
    }),
    { code: 'FORBIDDEN' },
  );
  assert.equal(database.recent(1)[0].status, 'failure');
});

test('open permission alone does not disclose the player roster', (t) => {
  const { service } = createHarness(t, ['varde.admin.open']);
  const bootstrap = service.execute(7, 'bootstrap', {});

  assert.deepEqual(bootstrap.players, []);
  assert.equal(bootstrap.permissions['varde.admin.players'], false);
});

test('moderation, teleport, economy, jobs, and items use trusted adapters', (t) => {
  const { service, database, calls } = createHarness(t);

  service.execute(7, 'player:freeze', { target: 8, frozen: true });
  service.execute(7, 'player:goto', { target: 8 });
  service.execute(7, 'economy:set', {
    target: 8,
    currency: 'bank',
    amount: 5000,
  });
  service.execute(7, 'job:assign', {
    target: 8,
    jobName: 'police',
    grade: 2,
  });
  service.execute(7, 'inventory:add', {
    target: 8,
    itemName: 'water',
    amount: 2,
  });

  assert.equal(service.listPlayers().find((player) => player.source === 8).frozen, true);
  assert.deepEqual(
    calls.find((call) => call.type === 'money').args.slice(0, 3),
    [8, 'bank', 5000],
  );
  assert.equal(calls.some((call) => call.type === 'job'), true);
  assert.equal(calls.some((call) => call.type === 'item'), true);
  assert.equal(database.recent(100).length, 5);
});
