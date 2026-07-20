'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
