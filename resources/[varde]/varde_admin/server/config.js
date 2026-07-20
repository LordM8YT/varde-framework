'use strict';

const path = require('node:path');
const { adminError } = require('./errors');

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw adminError(
      'CONFIG_INVALID',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function validateConfig(input, resourcePath = process.cwd()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw adminError('CONFIG_INVALID', 'admin config must be an object');
  }
  return {
    databaseFile: path.resolve(
      resourcePath,
      String(input.databaseFile || 'data/admin.sqlite'),
    ),
    auditRetentionDays: integer(
      input.auditRetentionDays ?? 180,
      1,
      3650,
      'auditRetentionDays',
    ),
    requestLimit: integer(input.requestLimit ?? 12, 1, 100, 'requestLimit'),
    requestWindowMs: integer(
      input.requestWindowMs ?? 10_000,
      1000,
      60_000,
      'requestWindowMs',
    ),
  };
}

function loadConfig(runtime) {
  const raw = runtime.loadResourceFile('config/admin.json');
  if (!raw) {
    throw adminError('CONFIG_MISSING', 'config/admin.json could not be loaded');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw adminError('CONFIG_INVALID', 'config/admin.json is not valid JSON');
  }
  return validateConfig(parsed, runtime.resourcePath);
}

module.exports = {
  loadConfig,
  validateConfig,
};
