'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AdminDatabase } = require('../server/database');

test('audit records persist bounded action details', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-admin-db-'));
  const database = new AdminDatabase(path.join(directory, 'admin.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  database.record({
    actorSource: 7,
    actorCharacterId: 'vrd_0123456789abcdef',
    action: 'player:freeze',
    targetSource: 8,
    targetCharacterId: 'vrd_fedcba9876543210',
    status: 'success',
    details: { frozen: true },
  });

  const entry = database.recent(1)[0];
  assert.equal(entry.action, 'player:freeze');
  assert.equal(entry.targetSource, 8);
  assert.deepEqual(entry.details, { frozen: true });
  assert.equal(entry.status, 'success');
});
