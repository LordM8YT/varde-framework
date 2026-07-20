'use strict';

const { jobsError } = require('./errors');

const JOB_NAME_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const PERMISSION_PATTERN = /^[a-z][a-z0-9_.:*]{1,63}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeJobName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!JOB_NAME_PATTERN.test(name)) {
    throw jobsError('VALIDATION_ERROR', 'job name is invalid');
  }
  return name;
}

function normalizeGrade(value) {
  const grade = Number(value);
  if (!Number.isSafeInteger(grade) || grade < 0 || grade > 1000) {
    throw jobsError('VALIDATION_ERROR', 'grade must be an integer from 0 to 1000');
  }
  return grade;
}

function normalizeCoordinates(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const z = Number(value?.z);
  if (![x, y, z].every(Number.isFinite)) {
    throw jobsError('POSITION_INVALID', 'player position is unavailable');
  }
  return { x, y, z };
}

class JobsService {
  constructor(database, config, core, runtime) {
    this.database = database;
    this.config = config;
    this.core = core;
    this.runtime = runtime;
  }

  resolveCharacterId(identifier) {
    if (typeof identifier === 'string' && identifier.startsWith('vrd_')) {
      return identifier;
    }
    const player = this.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw jobsError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    return player.characterId;
  }

  resolveOnline(identifier) {
    const player = this.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw jobsError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    const source =
      typeof identifier === 'number' || /^\d+$/.test(String(identifier))
        ? Number(identifier)
        : Number(this.core.getPlayerSource(player.characterId));
    if (!Number.isSafeInteger(source) || source <= 0) {
      throw jobsError('PLAYER_NOT_FOUND', 'online player source was not found');
    }
    return { source, characterId: player.characterId };
  }

  definition(jobName, grade) {
    const job = this.config.jobs[jobName];
    if (!job) {
      throw jobsError('JOB_NOT_FOUND', `job ${jobName} is not configured`);
    }
    const gradeDefinition = job.grades[grade];
    if (!gradeDefinition) {
      throw jobsError(
        'GRADE_NOT_FOUND',
        `grade ${grade} is not configured for ${jobName}`,
      );
    }
    return { job, gradeDefinition };
  }

  decorate(assignment) {
    const { job, gradeDefinition } = this.definition(
      assignment.name,
      assignment.grade,
    );
    return {
      name: assignment.name,
      label: job.label,
      type: job.type,
      grade: assignment.grade,
      gradeLabel: gradeDefinition.label,
      payment: gradeDefinition.payment,
      onDuty: assignment.onDuty,
      active: assignment.active,
      permissions: [...gradeDefinition.permissions],
      assignedAt: assignment.assignedAt,
      updatedAt: assignment.updatedAt,
    };
  }

  ensureDefaults(characterId) {
    if (!this.database.get(characterId, this.config.defaultJob)) {
      this.database.assign(characterId, this.config.defaultJob, 0, 'system');
    }
    if (!this.database.active(characterId)) {
      this.database.setActive(characterId, this.config.defaultJob, 'system');
    }
  }

  getJobs(identifier) {
    const characterId = this.resolveCharacterId(identifier);
    this.ensureDefaults(characterId);
    return this.database.list(characterId).map((entry) => this.decorate(entry));
  }

  snapshot(identifier) {
    const jobs = this.getJobs(identifier);
    return {
      jobs,
      activeJob: jobs.find((job) => job.active) || null,
    };
  }

  sync(identifier) {
    const player = this.resolveOnline(identifier);
    const snapshot = this.snapshot(player.characterId);
    if (!snapshot.activeJob) {
      throw jobsError('ACTIVE_JOB_MISSING', 'character has no active job');
    }

    const active = snapshot.activeJob;
    const result = this.core.setJob(player.source, {
      name: active.name,
      label: active.label,
      type: active.type,
      grade: active.grade,
      gradeLabel: active.gradeLabel,
      payment: active.payment,
      onDuty: active.onDuty,
    });
    if (result && result.ok === false) {
      throw jobsError(
        result.error?.code || 'CORE_ERROR',
        result.error?.message || 'core rejected the active job',
      );
    }

    this.runtime.emitClient(
      player.source,
      'varde_jobs:client:update',
      clone(snapshot),
    );
    return snapshot;
  }

  assign(identifier, jobName, grade, actor = 'resource') {
    const player = this.resolveOnline(identifier);
    const name = normalizeJobName(jobName);
    const validGrade = normalizeGrade(grade);
    this.definition(name, validGrade);
    const existing = this.database.get(player.characterId, name);
    if (!existing && this.database.count(player.characterId) >= this.config.maxJobs) {
      throw jobsError(
        'JOB_LIMIT_REACHED',
        `a character can have at most ${this.config.maxJobs} jobs`,
      );
    }
    this.database.assign(player.characterId, name, validGrade, actor);
    return this.sync(player.source);
  }

  remove(identifier, jobName, actor = 'resource') {
    const player = this.resolveOnline(identifier);
    const name = normalizeJobName(jobName);
    if (name === this.config.defaultJob) {
      throw jobsError('DEFAULT_JOB_REQUIRED', 'the default job cannot be removed');
    }
    const removed = this.database.remove(player.characterId, name, actor);
    if (!removed) {
      throw jobsError('JOB_NOT_ASSIGNED', `${name} is not assigned`);
    }
    if (removed.wasActive) {
      this.ensureDefaults(player.characterId);
      this.database.setActive(
        player.characterId,
        this.config.defaultJob,
        actor,
      );
    }
    return this.sync(player.source);
  }

  setActive(identifier, jobName, actor = 'player') {
    const player = this.resolveOnline(identifier);
    const name = normalizeJobName(jobName);
    this.database.setActive(player.characterId, name, actor);
    return this.sync(player.source);
  }

  setDuty(identifier, onDuty, actor = 'player') {
    const player = this.resolveOnline(identifier);
    this.ensureDefaults(player.characterId);
    const active = this.database.active(player.characterId);
    if (!active) {
      throw jobsError('ACTIVE_JOB_MISSING', 'character has no active job');
    }
    this.database.setDuty(
      player.characterId,
      active.name,
      onDuty === true,
      actor,
    );
    return this.sync(player.source);
  }

  toggleDuty(identifier, actor = 'player') {
    const player = this.resolveOnline(identifier);
    this.ensureDefaults(player.characterId);
    const active = this.database.active(player.characterId);
    return this.setDuty(player.source, !active.onDuty, actor);
  }

  clockAtDutyPoint(identifier, jobName, coordinates, actor = 'player') {
    const player = this.resolveOnline(identifier);
    const name = normalizeJobName(jobName);
    const assignment = this.database.get(player.characterId, name);
    if (!assignment) {
      throw jobsError('JOB_NOT_ASSIGNED', `${name} is not assigned`);
    }
    const position = normalizeCoordinates(coordinates);
    const points = this.config.jobs[name]?.dutyPoints || [];
    const nearby = points.some((point) => {
      const distance = Math.hypot(
        position.x - point.x,
        position.y - point.y,
        position.z - point.z,
      );
      return distance <= point.radius + 1.5;
    });
    if (!nearby) {
      throw jobsError(
        'DUTY_POINT_REQUIRED',
        'move closer to a configured duty point',
      );
    }

    const active = this.database.active(player.characterId);
    if (!active || active.name !== name) {
      this.database.setActive(player.characterId, name, actor);
      this.database.setDuty(player.characterId, name, true, actor);
    } else {
      this.database.setDuty(player.characterId, name, !active.onDuty, actor);
    }
    return this.sync(player.source);
  }

  clearDuty(characterId, actor = 'system') {
    this.ensureDefaults(characterId);
    const active = this.database.active(characterId);
    if (active?.onDuty) {
      this.database.setDuty(characterId, active.name, false, actor);
    }
  }

  deleteCharacter(characterId) {
    return this.database.deleteCharacter(String(characterId));
  }

  hasJob(identifier, jobName, minimumGrade = 0) {
    try {
      const characterId = this.resolveCharacterId(identifier);
      const assignment = this.database.get(
        characterId,
        normalizeJobName(jobName),
      );
      return Boolean(
        assignment && assignment.grade >= normalizeGrade(minimumGrade),
      );
    } catch {
      return false;
    }
  }

  hasPermission(identifier, permission, options = {}) {
    try {
      const name = String(permission || '').trim();
      if (!PERMISSION_PATTERN.test(name)) {
        return false;
      }
      const characterId = this.resolveCharacterId(identifier);
      this.ensureDefaults(characterId);
      const active = this.database.active(characterId);
      if (!active) {
        return false;
      }
      const decorated = this.decorate(active);
      const requiresDuty =
        options.requireDuty === undefined
          ? this.config.permissionRequiresDuty
          : options.requireDuty === true;
      if (requiresDuty && !decorated.onDuty) {
        return false;
      }
      return (
        decorated.permissions.includes('*') ||
        decorated.permissions.includes(name)
      );
    } catch {
      return false;
    }
  }
}

module.exports = {
  JobsService,
  normalizeCoordinates,
  normalizeGrade,
  normalizeJobName,
};
