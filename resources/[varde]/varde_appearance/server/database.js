'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { appearanceError } = require('./errors');

function hydrate(row) {
  if (!row) {
    return null;
  }
  try {
    return {
      characterId: row.character_id,
      appearance: JSON.parse(row.appearance_json),
      updatedAt: row.updated_at,
    };
  } catch {
    throw appearanceError(
      'APPEARANCE_CORRUPT',
      'stored appearance data is not valid JSON',
    );
  }
}

class AppearanceDatabase {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec(`
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
      throw appearanceError(
        'DATABASE_NEWER',
        `database schema ${version} is newer than this resource supports`,
      );
    }
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE character_appearance (
          character_id TEXT PRIMARY KEY,
          appearance_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  prepare() {
    this.statements = {
      get: this.database.prepare(
        'SELECT * FROM character_appearance WHERE character_id = ?',
      ),
      upsert: this.database.prepare(`
        INSERT INTO character_appearance (
          character_id, appearance_json, updated_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(character_id)
        DO UPDATE SET
          appearance_json = excluded.appearance_json,
          updated_at = excluded.updated_at
      `),
      delete: this.database.prepare(
        'DELETE FROM character_appearance WHERE character_id = ?',
      ),
    };
  }

  get(characterId) {
    return hydrate(this.statements.get.get(characterId));
  }

  save(characterId, appearance) {
    this.statements.upsert.run(
      characterId,
      JSON.stringify(appearance),
      new Date().toISOString(),
    );
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
  AppearanceDatabase,
};
