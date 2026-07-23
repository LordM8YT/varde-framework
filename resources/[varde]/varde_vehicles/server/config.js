'use strict';

const path = require('node:path');
const { vehiclesError } = require('./errors');

const GARAGE_ID_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const VEHICLE_TYPES = new Set([
  'automobile',
  'bike',
  'boat',
  'heli',
  'plane',
  'submarine',
  'trailer',
  'train',
]);

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw vehiclesError(
      'CONFIG_INVALID',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function number(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw vehiclesError(
      'CONFIG_INVALID',
      `${label} must be between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function point(value, label, heading = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw vehiclesError('CONFIG_INVALID', `${label} must be an object`);
  }
  const result = {
    x: number(value.x, -20_000, 20_000, `${label}.x`),
    y: number(value.y, -20_000, 20_000, `${label}.y`),
    z: number(value.z, -5_000, 5_000, `${label}.z`),
  };
  if (heading) {
    result.heading = number(value.heading ?? 0, -360, 360, `${label}.heading`);
  }
  return result;
}

function validateConfig(input, resourcePath = process.cwd()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw vehiclesError('CONFIG_INVALID', 'vehicle config must be an object');
  }
  if (!input.garages || typeof input.garages !== 'object') {
    throw vehiclesError('CONFIG_INVALID', 'garages must be an object');
  }

  const garages = Object.create(null);
  for (const [id, value] of Object.entries(input.garages)) {
    if (!GARAGE_ID_PATTERN.test(id) || !value || typeof value !== 'object') {
      throw vehiclesError('CONFIG_INVALID', `garage ${id} is invalid`);
    }
    const label = String(value.label || '').trim();
    if (!label || label.length > 64) {
      throw vehiclesError('CONFIG_INVALID', `garage ${id} label is invalid`);
    }
    const blip = value.blip
      ? {
          sprite: integer(value.blip.sprite ?? 357, 0, 1000, `${id}.blip.sprite`),
          color: integer(value.blip.color ?? 3, 0, 100, `${id}.blip.color`),
          scale: number(value.blip.scale ?? 0.75, 0.1, 5, `${id}.blip.scale`),
        }
      : null;
    const vehicleTypes = (
      Array.isArray(value.vehicleTypes)
        ? value.vehicleTypes
        : ['automobile', 'bike', 'trailer']
    ).map((entry) => String(entry || '').trim().toLowerCase());
    if (
      vehicleTypes.length === 0 ||
      vehicleTypes.some((entry) => !VEHICLE_TYPES.has(entry))
    ) {
      throw vehiclesError(
        'CONFIG_INVALID',
        `garage ${id} vehicleTypes are invalid`,
      );
    }
    garages[id] = {
      id,
      label,
      menu: point(value.menu, `${id}.menu`),
      spawn: point(value.spawn, `${id}.spawn`, true),
      store: point(value.store, `${id}.store`),
      blip,
      vehicleTypes: [...new Set(vehicleTypes)],
    };
  }
  if (Object.keys(garages).length === 0) {
    throw vehiclesError('CONFIG_INVALID', 'at least one garage is required');
  }

  return {
    databaseFile: path.resolve(
      resourcePath,
      String(input.databaseFile || 'data/vehicles.sqlite'),
    ),
    interactionDistance: number(
      input.interactionDistance ?? 3,
      1,
      20,
      'interactionDistance',
    ),
    entityDistance: number(
      input.entityDistance ?? 6,
      2,
      30,
      'entityDistance',
    ),
    trunkSlots: integer(input.trunkSlots ?? 40, 1, 500, 'trunkSlots'),
    trunkMaxWeight: integer(
      input.trunkMaxWeight ?? 100_000,
      0,
      2_000_000_000,
      'trunkMaxWeight',
    ),
    garages,
  };
}

function loadConfig(runtime) {
  const raw = runtime.loadResourceFile('config/vehicles.json');
  if (!raw) {
    throw vehiclesError(
      'CONFIG_MISSING',
      'config/vehicles.json could not be loaded',
    );
  }
  try {
    return validateConfig(JSON.parse(raw), runtime.resourcePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw vehiclesError(
        'CONFIG_INVALID',
        'config/vehicles.json is not valid JSON',
      );
    }
    throw error;
  }
}

module.exports = {
  loadConfig,
  validateConfig,
};
