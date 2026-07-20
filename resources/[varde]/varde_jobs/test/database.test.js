'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JobsDatabase } = require('../server/database');

function createDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-jobs-db-'));
  const database = new JobsDatabase(path.join(directory, 'jobs.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

test('assignments keep one active job and record an audit trail', (t) => {
  const database = createDatabase(t);
  const characterId = 'vrd_0123456789abcdef';

  database.assign(characterId, 'unemployed', 0, 'test');
  database.assign(characterId, 'police', 1, 'test');
  database.setActive(characterId, 'police', 'test');
  database.setDuty(characterId, 'police', true, 'test');

  const jobs = database.list(characterId);
  assert.equal(jobs.length, 2);
  assert.equal(jobs.filter((job) => job.active).length, 1);
  assert.equal(database.active(characterId).name, 'police');
  assert.equal(database.active(characterId).onDuty, true);
  assert.deepEqual(
    database.listAudit(characterId).map((entry) => entry.action),
    ['assigned', 'assigned', 'activated', 'duty_changed'],
  );
});

test('removing an assignment reports whether it was active', (t) => {
  const database = createDatabase(t);
  const characterId = 'vrd_fedcba9876543210';
  database.assign(characterId, 'unemployed', 0, 'test');

  assert.deepEqual(database.remove(characterId, 'unemployed', 'test'), {
    wasActive: true,
  });
  assert.equal(database.count(characterId), 0);
  assert.equal(database.remove(characterId, 'unemployed', 'test'), null);
});
