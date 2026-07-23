'use strict';

const { randomBytes } = require('node:crypto');
const { vehiclesError } = require('./errors');

const CHARACTER_ID_PATTERN = /^vrd_[a-f0-9]{16}$/;
const VEHICLE_ID_PATTERN = /^veh_[a-f0-9]{16}$/;
const MODEL_PATTERN = /^[A-Za-z0-9_]{1,48}$/;
const PLATE_PATTERN = /^[A-Z0-9]{1,8}$/;
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

function canonicalize(value, depth = 0) {
  if (depth > 6) {
    throw vehiclesError('PROPERTIES_INVALID', 'properties are nested too deeply');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) {
      throw vehiclesError('PROPERTIES_INVALID', 'properties array is too large');
    }
    return value.map((entry) => canonicalize(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result = {};
    const keys = Object.keys(value).sort();
    if (keys.length > 256) {
      throw vehiclesError('PROPERTIES_INVALID', 'properties have too many keys');
    }
    for (const key of keys) {
      if (
        key.length > 64 ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype'
      ) {
        throw vehiclesError('PROPERTIES_INVALID', 'property key is invalid');
      }
      result[key] = canonicalize(value[key], depth + 1);
    }
    return result;
  }
  throw vehiclesError('PROPERTIES_INVALID', 'properties contain invalid data');
}

function normalizeProperties(value) {
  const properties = canonicalize(value ?? {});
  if (!properties || Array.isArray(properties) || typeof properties !== 'object') {
    throw vehiclesError('PROPERTIES_INVALID', 'properties must be an object');
  }
  if (Buffer.byteLength(JSON.stringify(properties), 'utf8') > 16_384) {
    throw vehiclesError('PROPERTIES_INVALID', 'properties exceed 16384 bytes');
  }
  return properties;
}

function normalizePosition(value) {
  const position = {
    x: Number(value?.x ?? value?.[0]),
    y: Number(value?.y ?? value?.[1]),
    z: Number(value?.z ?? value?.[2]),
  };
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    throw vehiclesError('POSITION_INVALID', 'player position is invalid');
  }
  return position;
}

function distance(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function boundedNumber(value, minimum, maximum, fallback) {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, result));
}

function runtimeProperties(value, previous) {
  const current = value && typeof value === 'object' ? value : {};
  return {
    ...previous,
    engineHealth: boundedNumber(
      current.engineHealth,
      -4_000,
      1_000,
      previous.engineHealth ?? 1_000,
    ),
    bodyHealth: boundedNumber(
      current.bodyHealth,
      0,
      1_000,
      previous.bodyHealth ?? 1_000,
    ),
    tankHealth: boundedNumber(
      current.tankHealth,
      0,
      1_000,
      previous.tankHealth ?? 1_000,
    ),
    fuelLevel: boundedNumber(
      current.fuelLevel,
      0,
      100,
      previous.fuelLevel ?? 100,
    ),
    dirtLevel: boundedNumber(
      current.dirtLevel,
      0,
      15,
      previous.dirtLevel ?? 0,
    ),
  };
}

class VehiclesService {
  constructor(database, config, core, runtime) {
    this.database = database;
    this.config = config;
    this.core = core;
    this.runtime = runtime;
  }

  resolveCharacter(identifier) {
    if (
      typeof identifier === 'string' &&
      CHARACTER_ID_PATTERN.test(identifier)
    ) {
      return identifier;
    }
    const player = this.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw vehiclesError('PLAYER_NOT_FOUND', 'player or character was not found');
    }
    return player.characterId;
  }

  resolveOnline(identifier) {
    const characterId = this.resolveCharacter(identifier);
    const source =
      typeof identifier === 'number' || /^\d+$/.test(String(identifier))
        ? Number(identifier)
        : Number(this.core.getPlayerSource(characterId));
    if (!Number.isSafeInteger(source) || source <= 0) {
      throw vehiclesError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    return { source, characterId };
  }

  garage(value) {
    const garage = this.config.garages[String(value || '')];
    if (!garage) {
      throw vehiclesError('GARAGE_NOT_FOUND', 'garage was not found');
    }
    return garage;
  }

  requireNear(position, target, maximum, code = 'TOO_FAR') {
    if (distance(normalizePosition(position), target) > maximum) {
      throw vehiclesError(code, 'player is too far away');
    }
  }

  requireVehicle(vehicleId) {
    const id = String(vehicleId || '');
    if (!VEHICLE_ID_PATTERN.test(id)) {
      throw vehiclesError('VEHICLE_INVALID', 'vehicle id is invalid');
    }
    const vehicle = this.database.getVehicle(id);
    if (!vehicle) {
      throw vehiclesError('VEHICLE_NOT_FOUND', 'vehicle was not found');
    }
    return vehicle;
  }

  requireAccess(vehicleId, characterId) {
    const vehicle = this.requireVehicle(vehicleId);
    const role = this.database.getKey(vehicle.id, characterId);
    if (!role) {
      throw vehiclesError('KEY_REQUIRED', 'vehicle key is required');
    }
    return { vehicle, role };
  }

  generatePlate() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
      const plate = `VR${suffix}`;
      if (!this.database.getByPlate(plate)) {
        return plate;
      }
    }
    throw vehiclesError('PLATE_EXHAUSTED', 'could not allocate a vehicle plate');
  }

  registerVehicle(identifier, input = {}) {
    const ownerCharacterId = this.resolveCharacter(identifier);
    const model = String(input.model || '').trim().toLowerCase();
    const modelHash = Number(input.modelHash);
    const vehicleType = String(input.vehicleType || 'automobile').toLowerCase();
    const garage = this.garage(input.garageId || Object.keys(this.config.garages)[0]);
    const plate = input.plate
      ? String(input.plate).replace(/\s/g, '').toUpperCase()
      : this.generatePlate();

    if (!MODEL_PATTERN.test(model)) {
      throw vehiclesError('MODEL_INVALID', 'vehicle model is invalid');
    }
    if (!Number.isSafeInteger(modelHash)) {
      throw vehiclesError('MODEL_INVALID', 'vehicle model hash is invalid');
    }
    if (!VEHICLE_TYPES.has(vehicleType)) {
      throw vehiclesError('TYPE_INVALID', 'vehicle type is invalid');
    }
    if (!garage.vehicleTypes.includes(vehicleType)) {
      throw vehiclesError(
        'GARAGE_TYPE_INVALID',
        'garage does not support this vehicle type',
      );
    }
    if (!PLATE_PATTERN.test(plate) || this.database.getByPlate(plate)) {
      throw vehiclesError('PLATE_INVALID', 'vehicle plate is invalid or in use');
    }

    return this.database.createVehicle({
      id: `veh_${randomBytes(8).toString('hex')}`,
      ownerCharacterId,
      model,
      modelHash,
      vehicleType,
      plate,
      garageId: garage.id,
      properties: normalizeProperties(input.properties),
    });
  }

  list(identifier) {
    const characterId = this.resolveCharacter(identifier);
    return this.database.listAccessible(characterId).map((vehicle) => ({
      ...vehicle,
      keyRole: this.database.getKey(vehicle.id, characterId),
    }));
  }

  sync(identifier) {
    const online = this.resolveOnline(identifier);
    const snapshot = { vehicles: this.list(online.characterId) };
    this.runtime.emitClient(
      online.source,
      'varde_vehicles:client:update',
      snapshot,
    );
    return snapshot;
  }

  prepareSpawn(identifier, vehicleId, garageId, position) {
    const online = this.resolveOnline(identifier);
    const garage = this.garage(garageId);
    this.requireNear(
      position,
      garage.menu,
      this.config.interactionDistance + 1,
      'GARAGE_TOO_FAR',
    );
    const { vehicle } = this.requireAccess(vehicleId, online.characterId);
    if (vehicle.state !== 'stored') {
      throw vehiclesError('VEHICLE_NOT_STORED', 'vehicle is not stored');
    }
    if (!garage.vehicleTypes.includes(vehicle.vehicleType)) {
      throw vehiclesError(
        'GARAGE_TYPE_INVALID',
        'garage does not support this vehicle type',
      );
    }
    return { online, vehicle, garage };
  }

  markSpawned(vehicleId, garageId, networkId) {
    const validNetworkId = Number(networkId);
    if (!Number.isSafeInteger(validNetworkId) || validNetworkId <= 0) {
      throw vehiclesError('NETWORK_INVALID', 'vehicle network id is invalid');
    }
    return this.database.markOut(vehicleId, garageId, validNetworkId);
  }

  prepareStore(identifier, networkId, garageId, position) {
    const online = this.resolveOnline(identifier);
    const garage = this.garage(garageId);
    this.requireNear(
      position,
      garage.store,
      this.config.interactionDistance + 4,
      'GARAGE_TOO_FAR',
    );
    const vehicle = this.database.getByNetwork(Number(networkId));
    if (!vehicle || vehicle.state !== 'out') {
      throw vehiclesError('VEHICLE_NOT_FOUND', 'active vehicle was not found');
    }
    this.requireAccess(vehicle.id, online.characterId);
    return { online, vehicle, garage };
  }

  markStored(vehicleId, garageId, properties) {
    const vehicle = this.requireVehicle(vehicleId);
    return this.database.markStored(
      vehicleId,
      garageId,
      normalizeProperties(runtimeProperties(properties, vehicle.properties)),
    );
  }

  prepareEntityAccess(identifier, networkId, playerPosition, entityPosition) {
    const online = this.resolveOnline(identifier);
    this.requireNear(
      playerPosition,
      normalizePosition(entityPosition),
      this.config.entityDistance,
      'ENTITY_TOO_FAR',
    );
    const vehicle = this.database.getByNetwork(Number(networkId));
    if (!vehicle || vehicle.state !== 'out') {
      throw vehiclesError('VEHICLE_NOT_FOUND', 'active vehicle was not found');
    }
    this.requireAccess(vehicle.id, online.characterId);
    return { online, vehicle };
  }

  toggleLock(identifier, networkId, playerPosition, entityPosition) {
    const access = this.prepareEntityAccess(
      identifier,
      networkId,
      playerPosition,
      entityPosition,
    );
    return this.database.setLocked(access.vehicle.id, !access.vehicle.locked);
  }

  giveKey(ownerIdentifier, targetIdentifier, vehicleId) {
    const ownerCharacterId = this.resolveCharacter(ownerIdentifier);
    const targetCharacterId = this.resolveCharacter(targetIdentifier);
    const vehicle = this.requireVehicle(vehicleId);
    if (vehicle.ownerCharacterId !== ownerCharacterId) {
      throw vehiclesError('OWNER_REQUIRED', 'only the owner can share this key');
    }
    this.database.addKey(vehicle.id, targetCharacterId, 'shared');
    return true;
  }

  revokeKey(ownerIdentifier, targetIdentifier, vehicleId) {
    const ownerCharacterId = this.resolveCharacter(ownerIdentifier);
    const targetCharacterId = this.resolveCharacter(targetIdentifier);
    const vehicle = this.requireVehicle(vehicleId);
    if (vehicle.ownerCharacterId !== ownerCharacterId) {
      throw vehiclesError('OWNER_REQUIRED', 'only the owner can revoke this key');
    }
    return this.database.removeKey(vehicle.id, targetCharacterId);
  }

  deleteCharacter(characterId) {
    if (!CHARACTER_ID_PATTERN.test(String(characterId))) {
      return { vehicles: 0, keys: 0 };
    }
    return this.database.deleteCharacter(characterId);
  }
}

module.exports = {
  VehiclesService,
  normalizeProperties,
};
