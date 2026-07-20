'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { InventoryDatabase } = require('../server/database');
const { InventoryService, normalizeMetadata } = require('../server/service');
const { validateConfig } = require('../server/config');

function createHarness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-inventory-'));
  const database = new InventoryDatabase(path.join(directory, 'inventory.sqlite'));
  const players = new Map([
    [7, { characterId: 'vrd_0123456789abcdef' }],
    [8, { characterId: 'vrd_fedcba9876543210' }],
  ]);
  const events = [];
  const core = {
    getPlayerData(identifier) {
      if (typeof identifier === 'string' && identifier.startsWith('vrd_')) {
        return (
          [...players.values()].find(
            (player) => player.characterId === identifier,
          ) || null
        );
      }
      return players.get(Number(identifier)) || null;
    },
    getPlayerSource(characterId) {
      for (const [source, player] of players) {
        if (player.characterId === characterId) {
          return source;
        }
      }
      return 0;
    },
  };
  const runtime = {
    emitClient(source, eventName, payload) {
      events.push({ source, eventName, payload });
    },
  };
  const config = validateConfig(
    {
      databaseFile: 'inventory.sqlite',
      playerSlots: 4,
      playerMaxWeight: 2500,
      items: {
        water: {
          label: 'Water',
          weight: 500,
          stackable: true,
          maxStack: 3,
        },
        bandage: {
          label: 'Bandage',
          weight: 100,
          stackable: true,
          maxStack: 10,
        },
        phone: {
          label: 'Phone',
          weight: 250,
          stackable: false,
          maxStack: 99,
        },
      },
    },
    directory,
  );
  const service = new InventoryService(database, config, core, runtime);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { service, database, events };
}

test('metadata is canonical and bounded', () => {
  assert.equal(
    normalizeMetadata({ z: 1, a: { y: 2, x: 3 } }).json,
    '{"a":{"x":3,"y":2},"z":1}',
  );
  assert.throws(() => normalizeMetadata({ value: Number.NaN }), {
    code: 'METADATA_INVALID',
  });
});

test('add, stack, weight, remove, and owner sync are server authoritative', (t) => {
  const { service, events } = createHarness(t);
  service.sync(7);
  let inventory = service.addItem(7, 'water', 4, { quality: 100 }, 'test');

  assert.deepEqual(
    inventory.items.map((item) => item.amount),
    [3, 1],
  );
  assert.equal(inventory.weight, 2000);
  assert.equal(service.getItemCount(7, 'water', { quality: 100 }), 4);
  assert.equal(service.canCarryItem(7, 'water', 2, { quality: 100 }), false);
  assert.throws(
    () => service.addItem(7, 'water', 2, { quality: 100 }, 'test'),
    { code: 'WEIGHT_LIMIT' },
  );
  assert.equal(service.getItemCount(7, 'water'), 4);

  inventory = service.removeItem(7, 'water', 2, undefined, 'test');
  assert.equal(service.getItemCount(7, 'water'), 2);
  assert.equal(inventory.weight, 1000);
  assert.equal(events.at(-1).eventName, 'varde_inventory:client:update');
});

test('non-stackable items occupy individual slots', (t) => {
  const { service } = createHarness(t);
  const inventory = service.addItem(7, 'phone', 2, {}, 'test');
  assert.equal(inventory.items.length, 2);
  assert.deepEqual(
    inventory.items.map((item) => item.amount),
    [1, 1],
  );
});

test('slot moves, swaps, and stash transfers are atomic', (t) => {
  const { service, database } = createHarness(t);
  service.addItem(7, 'water', 2, {}, 'test', 1);
  service.addItem(7, 'bandage', 1, {}, 'test', 2);

  let inventory = service.moveSlot(7, 1, 2, undefined, 'test');
  assert.equal(inventory.items.find((item) => item.slot === 1).name, 'bandage');
  assert.equal(inventory.items.find((item) => item.slot === 2).name, 'water');

  service.registerStash('evidence', 'Evidence', 5, 10000);
  const transfer = service.transfer(7, 'stash:evidence', 2, 1, 4, 'test');
  assert.equal(transfer.from.items.find((item) => item.name === 'water').amount, 1);
  assert.equal(transfer.to.items[0].slot, 4);
  assert.equal(transfer.to.items[0].name, 'water');
  assert.equal(
    database.listAudit('stash:evidence').at(-1).action,
    'transferred',
  );
});

test('usable item handlers explicitly choose consumption', (t) => {
  const { service } = createHarness(t);
  service.addItem(7, 'bandage', 2, {}, 'test');
  let usedBy = 0;
  service.registerUsableItem('bandage', (source) => {
    usedBy = source;
    return { consume: 1 };
  });

  service.useItem(7, 1);
  assert.equal(usedBy, 7);
  assert.equal(service.getItemCount(7, 'bandage'), 1);
});

test('character cleanup deletes the private container', (t) => {
  const { service } = createHarness(t);
  service.addItem(7, 'bandage', 1, {}, 'test');
  assert.equal(service.deleteCharacter('vrd_0123456789abcdef'), true);
  assert.equal(service.getItemCount('vrd_0123456789abcdef', 'bandage'), 0);
});
