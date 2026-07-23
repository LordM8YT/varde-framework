'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { statusError } = require('./errors');

function nowIso() {
  return new Date().toISOString();
}

function hydrate(row) {
  if (!row) {
    return null;
  }
  let values;
  try {
    values = JSON.parse(row.values_json);
  } catch {
    throw statusError('DATABASE_CORRUPT', 'status values are not valid JSON');
  }
  return {
    characterId: row.character_id,
    values,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class StatusDatabase {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
    this.migrate();
    this.prepare();
  }

  migrate() {
    const version = Number(
      this.database.prepare('PRAGMA user_version').get().user_version,
    );
    if (version > 1) {
      throw statusError(
        'DATABASE_NEWER',
        `database schema ${version} is newer than this resource supports`,
      );
    }
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE status_profiles (
          character_id TEXT PRIMARY KEY,
          values_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  prepare() {
    this.statements = {
      get: this.database.prepare(`
        SELECT * FROM status_profiles WHERE character_id = ?
      `),
      create: this.database.prepare(`
        INSERT INTO status_profiles (
          character_id, values_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(character_id) DO NOTHING
      `),
      save: this.database.prepare(`
        UPDATE status_profiles
        SET values_json = ?, updated_at = ?
        WHERE character_id = ?
      `),
      delete: this.database.prepare(`
        DELETE FROM status_profiles WHERE character_id = ?
      `),
    };
  }

  get(characterId) {
    return hydrate(this.statements.get.get(characterId));
  }

  ensure(characterId, defaults) {
    const timestamp = nowIso();
    this.statements.create.run(
      characterId,
      JSON.stringify(defaults),
      timestamp,
      timestamp,
    );
    return this.get(characterId);
  }

  save(characterId, values) {
    const changes = Number(
      this.statements.save.run(
        JSON.stringify(values),
        nowIso(),
        characterId,
      ).changes,
    );
    if (changes !== 1) {
      throw statusError('STATUS_NOT_FOUND', 'status profile was not found');
    }
    return this.get(characterId);
  }

  delete(characterId) {
    return Number(this.statements.delete.run(characterId).changes) === 1;
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  StatusDatabase,
};
