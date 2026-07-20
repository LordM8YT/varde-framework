'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { adminError } = require('./errors');

function nowIso() {
  return new Date().toISOString();
}

class AdminDatabase {
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
      throw adminError(
        'DATABASE_NEWER',
        `database schema ${version} is newer than this resource supports`,
      );
    }
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE admin_audit (
          id INTEGER PRIMARY KEY,
          actor_source INTEGER NOT NULL,
          actor_character_id TEXT,
          action TEXT NOT NULL,
          target_source INTEGER,
          target_character_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
          details_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX admin_audit_created_idx
          ON admin_audit(created_at DESC);
        CREATE INDEX admin_audit_actor_idx
          ON admin_audit(actor_character_id, id DESC);
        CREATE INDEX admin_audit_target_idx
          ON admin_audit(target_character_id, id DESC);

        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  prepare() {
    this.statements = {
      insert: this.database.prepare(`
        INSERT INTO admin_audit (
          actor_source,
          actor_character_id,
          action,
          target_source,
          target_character_id,
          status,
          details_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      recent: this.database.prepare(`
        SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?
      `),
      prune: this.database.prepare(`
        DELETE FROM admin_audit WHERE created_at < ?
      `),
    };
  }

  record(entry) {
    let details = '{}';
    try {
      details = JSON.stringify(entry.details || {});
    } catch {
      details = '{"serialization":"failed"}';
    }
    if (Buffer.byteLength(details, 'utf8') > 8192) {
      details = JSON.stringify({ truncated: true });
    }
    this.statements.insert.run(
      Number(entry.actorSource) || 0,
      entry.actorCharacterId || null,
      String(entry.action).slice(0, 96),
      entry.targetSource ? Number(entry.targetSource) : null,
      entry.targetCharacterId || null,
      entry.status === 'success' ? 'success' : 'failure',
      details,
      nowIso(),
    );
  }

  recent(limit = 100) {
    return this.statements.recent
      .all(Math.max(1, Math.min(500, Number(limit) || 100)))
      .map((row) => ({
        id: Number(row.id),
        actorSource: Number(row.actor_source),
        actorCharacterId: row.actor_character_id,
        action: row.action,
        targetSource: row.target_source ? Number(row.target_source) : null,
        targetCharacterId: row.target_character_id,
        status: row.status,
        details: JSON.parse(row.details_json),
        createdAt: row.created_at,
      }));
  }

  prune(days) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return Number(this.statements.prune.run(cutoff).changes);
  }

  close() {
    this.statements = null;
    this.database.close();
  }
}

module.exports = {
  AdminDatabase,
};
