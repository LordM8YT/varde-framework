'use strict';

const path = require('node:path');
const { jobsError } = require('./errors');

const NAME_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const PERMISSION_PATTERN = /^[a-z][a-z0-9_.:*]{1,63}$/;

function boundedInteger(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw jobsError(
      'CONFIG_INVALID',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function validateConfig(input, resourcePath = process.cwd()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw jobsError('CONFIG_INVALID', 'jobs config must be an object');
  }

  const defaultJob = String(input.defaultJob || '').trim();
  const jobs = Object.create(null);

  if (!input.jobs || typeof input.jobs !== 'object' || Array.isArray(input.jobs)) {
    throw jobsError('CONFIG_INVALID', 'jobs must be an object');
  }

  for (const [name, value] of Object.entries(input.jobs)) {
    if (!NAME_PATTERN.test(name)) {
      throw jobsError('CONFIG_INVALID', `job name ${name} is invalid`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw jobsError('CONFIG_INVALID', `job ${name} must be an object`);
    }

    const label = String(value.label || '').trim();
    const type = String(value.type || '').trim();
    if (!label || label.length > 64 || !NAME_PATTERN.test(type)) {
      throw jobsError('CONFIG_INVALID', `job ${name} has an invalid label or type`);
    }

    const grades = Object.create(null);
    if (
      !value.grades ||
      typeof value.grades !== 'object' ||
      Array.isArray(value.grades)
    ) {
      throw jobsError('CONFIG_INVALID', `job ${name} must define grades`);
    }

    for (const [gradeKey, gradeValue] of Object.entries(value.grades)) {
      const grade = boundedInteger(gradeKey, 0, 1000, `${name} grade`);
      if (
        !gradeValue ||
        typeof gradeValue !== 'object' ||
        Array.isArray(gradeValue)
      ) {
        throw jobsError('CONFIG_INVALID', `${name} grade ${grade} is invalid`);
      }
      const gradeLabel = String(gradeValue.label || '').trim();
      if (!gradeLabel || gradeLabel.length > 64) {
        throw jobsError(
          'CONFIG_INVALID',
          `${name} grade ${grade} has an invalid label`,
        );
      }

      const permissions = Array.isArray(gradeValue.permissions)
        ? [...new Set(gradeValue.permissions.map((entry) => String(entry).trim()))]
        : [];
      if (permissions.some((permission) => !PERMISSION_PATTERN.test(permission))) {
        throw jobsError(
          'CONFIG_INVALID',
          `${name} grade ${grade} contains an invalid permission`,
        );
      }

      grades[grade] = {
        label: gradeLabel,
        payment: boundedInteger(
          gradeValue.payment || 0,
          0,
          1_000_000,
          `${name} grade ${grade} payment`,
        ),
        permissions,
      };
    }

    if (Object.keys(grades).length === 0) {
      throw jobsError('CONFIG_INVALID', `job ${name} must define at least one grade`);
    }
    jobs[name] = { label, type, grades };
  }

  if (!jobs[defaultJob]) {
    throw jobsError('CONFIG_INVALID', 'defaultJob must reference a configured job');
  }

  const databaseFile = path.resolve(
    resourcePath,
    String(input.databaseFile || 'data/jobs.sqlite'),
  );

  return {
    databaseFile,
    defaultJob,
    maxJobs: boundedInteger(input.maxJobs ?? 5, 1, 25, 'maxJobs'),
    permissionRequiresDuty: input.permissionRequiresDuty !== false,
    jobs,
  };
}

function loadConfig(runtime) {
  const raw = runtime.loadResourceFile('config/jobs.json');
  if (!raw) {
    throw jobsError('CONFIG_MISSING', 'config/jobs.json could not be loaded');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw jobsError('CONFIG_INVALID', 'config/jobs.json is not valid JSON');
  }
  return validateConfig(parsed, runtime.resourcePath);
}

module.exports = {
  loadConfig,
  validateConfig,
};
