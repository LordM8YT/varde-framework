'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  backupDatabaseSet,
  databaseFiles,
  verifyBackup,
} = require('../varde-data');

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-data-'));
  const data = path.join(
    root,
    'resources',
    '[varde]',
    'varde_fixture',
    'data',
  );
  fs.mkdirSync(data, { recursive: true });
  const filename = path.join(data, 'fixture.sqlite');
  const database = new DatabaseSync(filename);
  database.exec(`
    CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO records (value) VALUES ('varde');
    PRAGMA user_version = 3;
  `);
  database.close();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, filename };
}

test('backup creates a verified manifest and consistent SQLite copy', async (t) => {
  const fixture = createFixture(t);
  const destination = path.join(fixture.root, 'backup');
  const manifest = await backupDatabaseSet(fixture.root, destination);

  assert.equal(databaseFiles(fixture.root).length, 1);
  assert.equal(manifest.databases[0].schemaVersion, 3);
  const verification = verifyBackup(destination);
  assert.equal(verification[0].integrity, 'ok');
  assert.equal(verification[0].schemaVersion, 3);
});

test('verification rejects a modified backup', async (t) => {
  const fixture = createFixture(t);
  const destination = path.join(fixture.root, 'backup');
  const manifest = await backupDatabaseSet(fixture.root, destination);
  const backupFile = path.join(
    destination,
    ...manifest.databases[0].file.split('/'),
  );
  fs.appendFileSync(backupFile, 'tampered');

  assert.throws(() => verifyBackup(destination), /checksum failed/);
});
