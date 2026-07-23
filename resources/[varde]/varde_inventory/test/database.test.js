'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { InventoryDatabase } = require('../server/database');

function createDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-inventory-db-'));
  const database = new InventoryDatabase(path.join(directory, 'inventory.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

test('containers persist slotted items and audit records', (t) => {
  const database = createDatabase(t);
  const container = database.ensureContainer(
    'stash:test',
    'stash',
    'test',
    'Test stash',
    10,
    5000,
  );
  const itemId = database.insertItem(
    container.id,
    1,
    'water',
    2,
    '{"quality":100}',
  );
  database.updateAmount(itemId, 3);
  database.audit(
    'added',
    null,
    container.id,
    'water',
    3,
    { quality: 100 },
    'test',
  );

  assert.equal(database.getItem(container.id, 1).amount, 3);
  assert.deepEqual(database.getItem(container.id, 1).metadata, { quality: 100 });
  assert.equal(database.listAudit(container.id)[0].action, 'added');
});

test('deleting a container cascades its item rows', (t) => {
  const database = createDatabase(t);
  database.ensureContainer('stash:delete', 'stash', 'delete', 'Delete', 5, 1000);
  database.insertItem('stash:delete', 1, 'bandage', 1, '{}');

  assert.equal(database.deleteContainer('stash:delete'), true);
  assert.deepEqual(database.listItems('stash:delete'), []);
  assert.equal(database.deleteContainer('stash:delete'), false);
});

test('world drop metadata cascades with its container', (t) => {
  const database = createDatabase(t);
  database.ensureContainer('drop:test', 'drop', 'owner', 'Ground', 5, 1000);
  const drop = database.createDrop(
    'drop:test',
    { x: 1, y: 2, z: 3 },
    '2030-01-01T00:00:00.000Z',
  );

  assert.deepEqual(drop.position, { x: 1, y: 2, z: 3 });
  assert.equal(database.listDrops().length, 1);
  database.deleteContainer('drop:test');
  assert.equal(database.getDrop('drop:test'), null);
});

test('schema 1 migrates to world drops without losing items', (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'varde-inventory-v1-'),
  );
  const filename = path.join(directory, 'inventory.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE inventory_containers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      label TEXT NOT NULL,
      slots INTEGER NOT NULL,
      max_weight INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY,
      container_id TEXT NOT NULL
        REFERENCES inventory_containers(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (container_id, slot)
    ) STRICT;
    CREATE TABLE inventory_audit (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      from_container TEXT,
      to_container TEXT,
      item_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      metadata_json TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO inventory_containers VALUES (
      'stash:legacy', 'stash', 'legacy', 'Legacy', 5, 1000,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
    INSERT INTO inventory_items VALUES (
      1, 'stash:legacy', 1, 'water', 1, '{}',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const database = new InventoryDatabase(filename);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(database.getItem('stash:legacy', 1).name, 'water');
  database.ensureContainer('drop:migrated', 'drop', 'owner', 'Ground', 5, 1000);
  database.createDrop(
    'drop:migrated',
    { x: 1, y: 2, z: 3 },
    '2030-01-01T00:00:00.000Z',
  );
  assert.equal(database.getDrop('drop:migrated').id, 'drop:migrated');
});
