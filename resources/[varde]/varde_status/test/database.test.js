'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { StatusDatabase } = require('../server/database');

function createDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-status-db-'));
  const database = new StatusDatabase(path.join(directory, 'status.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

test('status profiles persist and delete with their character', (t) => {
  const database = createDatabase(t);
  const characterId = 'vrd_0123456789abcdef';
  const created = database.ensure(characterId, {
    hunger: 100,
    thirst: 100,
    stress: 0,
  });
  assert.equal(created.values.hunger, 100);

  database.save(characterId, {
    hunger: 75,
    thirst: 60,
    stress: 10,
  });
  assert.deepEqual(database.get(characterId).values, {
    hunger: 75,
    thirst: 60,
    stress: 10,
  });
  assert.equal(database.delete(characterId), true);
  assert.equal(database.get(characterId), null);
});
