'use strict';

const path = require('node:path');
const { frameworkError } = require('./errors');

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw frameworkError('CONFIG_INVALID', `${name} must be an object`);
  }
}

function positiveInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw frameworkError(
      'CONFIG_INVALID',
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function finiteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw frameworkError('CONFIG_INVALID', `${name} must be a finite number`);
  }
  return value;
}

function localeName(value, name) {
  const locale = String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-');
  if (!/^[a-z0-9-]{2,16}$/u.test(locale)) {
    throw frameworkError('CONFIG_INVALID', `${name} is invalid`);
  }
  return locale;
}

function validateConfig(input, resourcePath) {
  assertObject(input, 'config');
  assertObject(input.startingMoney, 'startingMoney');
  assertObject(input.defaultJob, 'defaultJob');
  assertObject(input.defaultSpawn, 'defaultSpawn');

  const databaseFile = String(input.databaseFile || '').trim();
  if (!databaseFile || path.isAbsolute(databaseFile) || databaseFile.includes('..')) {
    throw frameworkError(
      'CONFIG_INVALID',
      'databaseFile must be a relative path inside varde_core',
    );
  }

  const jobName = String(input.defaultJob.name || '').trim();
  const jobLabel = String(input.defaultJob.label || '').trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(jobName) || !jobLabel) {
    throw frameworkError('CONFIG_INVALID', 'defaultJob is invalid');
  }

  return Object.freeze({
    locale: localeName(input.locale || 'en', 'locale'),
    fallbackLocale: localeName(
      input.fallbackLocale || 'en',
      'fallbackLocale',
    ),
    databaseFile: path.join(resourcePath, databaseFile),
    maxCharacters: positiveInteger(input.maxCharacters, 'maxCharacters', 1, 10),
    saveIntervalMs: positiveInteger(
      input.saveIntervalMs,
      'saveIntervalMs',
      10_000,
      600_000,
    ),
    positionSyncMs: positiveInteger(
      input.positionSyncMs,
      'positionSyncMs',
      5_000,
      120_000,
    ),
    startingMoney: Object.freeze({
      cash: positiveInteger(input.startingMoney.cash, 'startingMoney.cash', 0, 1_000_000_000),
      bank: positiveInteger(input.startingMoney.bank, 'startingMoney.bank', 0, 1_000_000_000),
    }),
    defaultJob: Object.freeze({
      name: jobName,
      label: jobLabel.slice(0, 64),
      grade: positiveInteger(input.defaultJob.grade, 'defaultJob.grade', 0, 1000),
      onDuty: input.defaultJob.onDuty === true,
    }),
    defaultSpawn: Object.freeze({
      x: finiteNumber(input.defaultSpawn.x, 'defaultSpawn.x'),
      y: finiteNumber(input.defaultSpawn.y, 'defaultSpawn.y'),
      z: finiteNumber(input.defaultSpawn.z, 'defaultSpawn.z'),
      heading: finiteNumber(input.defaultSpawn.heading, 'defaultSpawn.heading'),
    }),
  });
}

function loadConfig(runtime) {
  const raw = runtime.loadResourceFile('config/defaults.json');
  if (!raw) {
    throw frameworkError('CONFIG_MISSING', 'config/defaults.json could not be loaded');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw frameworkError('CONFIG_INVALID', `config/defaults.json: ${error.message}`);
  }

  const maxCharacters = runtime.getConvarInt(
    'varde_maxCharacters',
    parsed.maxCharacters,
  );
  const saveIntervalMs = runtime.getConvarInt(
    'varde_saveIntervalMs',
    parsed.saveIntervalMs,
  );
  const getConvar =
    typeof runtime.getConvar === 'function'
      ? runtime.getConvar.bind(runtime)
      : (_name, fallback) => fallback;
  const locale = getConvar('varde_locale', parsed.locale || 'en');
  const fallbackLocale = getConvar(
    'varde_fallbackLocale',
    parsed.fallbackLocale || 'en',
  );

  return validateConfig(
    {
      ...parsed,
      locale,
      fallbackLocale,
      maxCharacters,
      saveIntervalMs,
    },
    runtime.resourcePath,
  );
}

module.exports = {
  loadConfig,
  validateConfig,
};
