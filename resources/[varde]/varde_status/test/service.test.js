'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { StatusDatabase } = require('../server/database');
const { StatusService } = require('../server/service');
const { validateConfig } = require('../server/config');

function createHarness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-status-'));
  const config = validateConfig(
    {
      databaseFile: 'status.sqlite',
      tickIntervalMs: 60_000,
      needs: {
        hunger: { default: 100, minimum: 0, maximum: 100, decay: 1 },
        thirst: { default: 100, minimum: 0, maximum: 100, decay: 2 },
        stress: { default: 0, minimum: 0, maximum: 100, decay: 0 },
      },
    },
    directory,
  );
  const database = new StatusDatabase(config.databaseFile);
  const player = {
    source: 7,
    characterId: 'vrd_0123456789abcdef',
  };
  const events = [];
  const core = {
    getPlayerData(identifier) {
      return Number(identifier) === 7 || identifier === player.characterId
        ? player
        : null;
    },
    getPlayerSource(characterId) {
      return characterId === player.characterId ? 7 : 0;
    },
    getPlayers() {
      return [player];
    },
  };
  const runtime = {
    emitClient(source, eventName, ...args) {
      events.push({ source, eventName, args });
    },
  };
  const service = new StatusService(database, config, core, runtime);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { service, database, events, player };
}

test('status mutations clamp, persist, and publish owner snapshots', (t) => {
  const { service, database, events, player } = createHarness(t);
  assert.deepEqual(service.sync(7), {
    hunger: 100,
    thirst: 100,
    stress: 0,
  });
  service.remove(7, 'hunger', 80);
  service.remove(7, 'hunger', 80);
  service.add(7, 'stress', 100);
  service.add(7, 'stress', 100);

  assert.deepEqual(service.get(7), {
    hunger: 0,
    thirst: 100,
    stress: 100,
  });
  assert.deepEqual(database.get(player.characterId).values, service.get(7));
  assert.ok(
    events.every(
      (event) =>
        event.source === 7 &&
        event.eventName === 'varde_status:client:update',
    ),
  );
});

test('server ticks decay configured needs and reset restores defaults', (t) => {
  const { service } = createHarness(t);
  service.sync(7);
  assert.equal(service.tick(), 1);
  assert.deepEqual(service.get(7), {
    hunger: 99,
    thirst: 98,
    stress: 0,
  });
  assert.deepEqual(service.reset(7), {
    hunger: 100,
    thirst: 100,
    stress: 0,
  });
});

test('character deletion removes private status data', (t) => {
  const { service, database, player } = createHarness(t);
  service.sync(7);
  assert.equal(service.deleteCharacter(player.characterId), true);
  assert.equal(database.get(player.characterId), null);
});
