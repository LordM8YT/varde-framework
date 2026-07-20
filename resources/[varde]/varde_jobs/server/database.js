'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { jobsError } = require('./errors');

function nowIso() {
  return new Date().toISOString();
}

function hydrate(row) {
  return row
    ? {
        characterId: row.character_id,
        name: row.job_name,
        grade: Number(row.grade),
        onDuty: row.on_duty === 1,
        active: row.is_active === 1,
        assignedAt: row.assigned_at,
        updatedAt: row.updated_at,
      }
    : null;
}

class JobsDatabase {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.inTransaction = false;
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
      throw jobsError(
        'DATABASE_NEWER',
        `database schema ${version} is newer than this resource supports`,
      );
    }
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE job_assignments (
          id INTEGER PRIMARY KEY,
          character_id TEXT NOT NULL,
          job_name TEXT NOT NULL,
          grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 1000),
          on_duty INTEGER NOT NULL DEFAULT 0 CHECK (on_duty IN (0, 1)),
          is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
          assigned_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (character_id, job_name)
        ) STRICT;

        CREATE INDEX job_assignments_character_idx
          ON job_assignments(character_id);
        CREATE UNIQUE INDEX job_assignments_one_active_idx
          ON job_assignments(character_id)
          WHERE is_active = 1;

        CREATE TABLE job_audit (
          id INTEGER PRIMARY KEY,
          character_id TEXT NOT NULL,
          action TEXT NOT NULL,
          job_name TEXT,
          details_json TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX job_audit_character_idx
          ON job_audit(character_id, id DESC);

        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  prepare() {
    this.statements = {
      list: this.database.prepare(`
        SELECT * FROM job_assignments
        WHERE character_id = ?
        ORDER BY is_active DESC, assigned_at ASC, job_name ASC
      `),
      get: this.database.prepare(`
        SELECT * FROM job_assignments
        WHERE character_id = ? AND job_name = ?
      `),
      active: this.database.prepare(`
        SELECT * FROM job_assignments
        WHERE character_id = ? AND is_active = 1
      `),
      count: this.database.prepare(`
        SELECT COUNT(*) AS count FROM job_assignments WHERE character_id = ?
      `),
      assign: this.database.prepare(`
        INSERT INTO job_assignments (
          character_id,
          job_name,
          grade,
          on_duty,
          is_active,
          assigned_at,
          updated_at
        ) VALUES (?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(character_id, job_name) DO UPDATE SET
          grade = excluded.grade,
          updated_at = excluded.updated_at
      `),
      clearActive: this.database.prepare(`
        UPDATE job_assignments
        SET is_active = 0, on_duty = 0, updated_at = ?
        WHERE character_id = ? AND is_active = 1
      `),
      activate: this.database.prepare(`
        UPDATE job_assignments
        SET is_active = 1, updated_at = ?
        WHERE character_id = ? AND job_name = ?
      `),
      duty: this.database.prepare(`
        UPDATE job_assignments
        SET on_duty = ?, updated_at = ?
        WHERE character_id = ? AND job_name = ?
      `),
      remove: this.database.prepare(`
        DELETE FROM job_assignments
        WHERE character_id = ? AND job_name = ?
        RETURNING is_active
      `),
      audit: this.database.prepare(`
        INSERT INTO job_audit (
          character_id,
          action,
          job_name,
          details_json,
          actor,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `),
      listAudit: this.database.prepare(`
        SELECT action, job_name, details_json, actor, created_at
        FROM job_audit
        WHERE character_id = ?
        ORDER BY id ASC
      `),
    };
  }

  transaction(work) {
    if (this.inTransaction) {
      throw jobsError('DATABASE_TRANSACTION', 'nested transactions are unsupported');
    }
    this.inTransaction = true;
    let began = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      began = true;
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (began) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  audit(characterId, action, jobName, details, actor) {
    this.statements.audit.run(
      characterId,
      action,
      jobName || null,
      JSON.stringify(details || {}),
      String(actor || 'system').slice(0, 96),
      nowIso(),
    );
  }

  list(characterId) {
    return this.statements.list.all(characterId).map(hydrate);
  }

  get(characterId, jobName) {
    return hydrate(this.statements.get.get(characterId, jobName));
  }

  active(characterId) {
    return hydrate(this.statements.active.get(characterId));
  }

  count(characterId) {
    return Number(this.statements.count.get(characterId).count);
  }

  assign(characterId, jobName, grade, actor) {
    const timestamp = nowIso();
    const makeActive = this.count(characterId) === 0 ? 1 : 0;
    this.transaction(() => {
      this.statements.assign.run(
        characterId,
        jobName,
        grade,
        makeActive,
        timestamp,
        timestamp,
      );
      this.audit(characterId, 'assigned', jobName, { grade }, actor);
    });
    return this.get(characterId, jobName);
  }

  setActive(characterId, jobName, actor) {
    if (!this.get(characterId, jobName)) {
      throw jobsError('JOB_NOT_ASSIGNED', `${jobName} is not assigned`);
    }
    this.transaction(() => {
      const timestamp = nowIso();
      this.statements.clearActive.run(timestamp, characterId);
      this.statements.activate.run(timestamp, characterId, jobName);
      this.audit(characterId, 'activated', jobName, {}, actor);
    });
    return this.active(characterId);
  }

  setDuty(characterId, jobName, onDuty, actor) {
    const assignment = this.get(characterId, jobName);
    if (!assignment) {
      throw jobsError('JOB_NOT_ASSIGNED', `${jobName} is not assigned`);
    }
    const timestamp = nowIso();
    this.transaction(() => {
      this.statements.duty.run(onDuty ? 1 : 0, timestamp, characterId, jobName);
      this.audit(characterId, 'duty_changed', jobName, { onDuty }, actor);
    });
    return this.get(characterId, jobName);
  }

  remove(characterId, jobName, actor) {
    let removed = null;
    this.transaction(() => {
      removed = this.statements.remove.get(characterId, jobName);
      if (removed) {
        this.audit(characterId, 'removed', jobName, {}, actor);
      }
    });
    return removed ? { wasActive: removed.is_active === 1 } : null;
  }

  listAudit(characterId) {
    return this.statements.listAudit.all(characterId).map((row) => ({
      action: row.action,
      jobName: row.job_name,
      details: JSON.parse(row.details_json),
      actor: row.actor,
      createdAt: row.created_at,
    }));
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  JobsDatabase,
};
