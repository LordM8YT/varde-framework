'use strict';

const path = require('node:path');
const { inventoryError } = require('./errors');

const ITEM_NAME_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw inventoryError(
      'CONFIG_INVALID',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function validateConfig(input, resourcePath = process.cwd()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw inventoryError('CONFIG_INVALID', 'inventory config must be an object');
  }
  if (!input.items || typeof input.items !== 'object' || Array.isArray(input.items)) {
    throw inventoryError('CONFIG_INVALID', 'items must be an object');
  }

  const items = Object.create(null);
  for (const [name, value] of Object.entries(input.items)) {
    if (!ITEM_NAME_PATTERN.test(name)) {
      throw inventoryError('CONFIG_INVALID', `item name ${name} is invalid`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw inventoryError('CONFIG_INVALID', `item ${name} must be an object`);
    }
    const label = String(value.label || '').trim();
    if (!label || label.length > 64) {
      throw inventoryError('CONFIG_INVALID', `item ${name} has an invalid label`);
    }
    const stackable = value.stackable !== false;
    const maxStack = stackable
      ? integer(value.maxStack ?? 1, 1, 100_000, `${name}.maxStack`)
      : 1;
    items[name] = {
      label,
      weight: integer(value.weight ?? 0, 0, 10_000_000, `${name}.weight`),
      stackable,
      maxStack,
    };
  }

  if (Object.keys(items).length === 0) {
    throw inventoryError('CONFIG_INVALID', 'at least one item must be configured');
  }

  return {
    databaseFile: path.resolve(
      resourcePath,
      String(input.databaseFile || 'data/inventory.sqlite'),
    ),
    playerSlots: integer(input.playerSlots ?? 40, 1, 500, 'playerSlots'),
    playerMaxWeight: integer(
      input.playerMaxWeight ?? 30_000,
      0,
      2_000_000_000,
      'playerMaxWeight',
    ),
    items,
  };
}

function loadConfig(runtime) {
  const raw = runtime.loadResourceFile('config/items.json');
  if (!raw) {
    throw inventoryError('CONFIG_MISSING', 'config/items.json could not be loaded');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw inventoryError('CONFIG_INVALID', 'config/items.json is not valid JSON');
  }
  return validateConfig(parsed, runtime.resourcePath);
}

module.exports = {
  loadConfig,
  validateConfig,
};
