'use strict';

const path = require('node:path');
const { appearanceError } = require('./errors');

const MODEL_PATTERN = /^[A-Za-z0-9_]{1,48}$/;

function validateConfig(input, resourcePath = process.cwd()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw appearanceError('CONFIG_INVALID', 'appearance config must be an object');
  }
  if (!Array.isArray(input.allowedModels) || input.allowedModels.length === 0) {
    throw appearanceError('CONFIG_INVALID', 'allowedModels must not be empty');
  }
  const allowedModels = [...new Set(input.allowedModels.map((entry) => {
    const model = String(entry || '').trim().toLowerCase();
    if (!MODEL_PATTERN.test(model)) {
      throw appearanceError('CONFIG_INVALID', 'allowed model is invalid');
    }
    return model;
  }))];
  const genderModels = {};
  for (const gender of ['male', 'female', 'unspecified']) {
    const model = String(input.genderModels?.[gender] || allowedModels[0])
      .trim()
      .toLowerCase();
    if (!allowedModels.includes(model)) {
      throw appearanceError(
        'CONFIG_INVALID',
        `gender model ${gender} is not allowed`,
      );
    }
    genderModels[gender] = model;
  }
  return {
    databaseFile: path.resolve(
      resourcePath,
      String(input.databaseFile || 'data/appearance.sqlite'),
    ),
    allowedModels,
    allowedModelSet: new Set(allowedModels),
    genderModels,
  };
}

function loadConfig(runtime) {
  const raw = runtime.loadResourceFile('config/appearance.json');
  if (!raw) {
    throw appearanceError(
      'CONFIG_MISSING',
      'config/appearance.json could not be loaded',
    );
  }
  try {
    return validateConfig(JSON.parse(raw), runtime.resourcePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw appearanceError(
        'CONFIG_INVALID',
        'config/appearance.json is not valid JSON',
      );
    }
    throw error;
  }
}

module.exports = {
  loadConfig,
  validateConfig,
};
