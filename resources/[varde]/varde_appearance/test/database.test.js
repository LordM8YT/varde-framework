'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppearanceDatabase } = require('../server/database');

test('appearance records persist and delete by character', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-appearance-'));
  const database = new AppearanceDatabase(path.join(directory, 'appearance.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const characterId = 'vrd_0123456789abcdef';
  database.save(characterId, {
    version: 1,
    model: 'mp_m_freemode_01',
  });
  assert.equal(database.get(characterId).appearance.version, 1);
  assert.equal(database.delete(characterId), true);
  assert.equal(database.get(characterId), null);
});
