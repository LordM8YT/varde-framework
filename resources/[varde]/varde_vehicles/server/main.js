'use strict';

const { VehiclesDatabase } = require('./database');
const { VehiclesError } = require('./errors');
const { loadConfig } = require('./config');
const { VehiclesService } = require('./service');

const resourceName = GetCurrentResourceName();
const runtime = {
  resourcePath: GetResourcePath(resourceName),
  loadResourceFile(relativePath) {
    return LoadResourceFile(resourceName, relativePath);
  },
  emitClient(source, eventName, ...args) {
    emitNet(eventName, source, ...args);
  },
  emitAll(eventName, ...args) {
    emitNet(eventName, -1, ...args);
  },
  log(level, message) {
    const output = `[varde_vehicles] [${level}] ${message}`;
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  },
};

const core = {
  getPlayerData(identifier) {
    return globalThis.exports.varde_core.GetPlayerData(identifier);
  },
  getPlayers() {
    return globalThis.exports.varde_core.GetPlayers();
  },
  getPlayerSource(characterId) {
    return globalThis.exports.varde_core.GetPlayerSource(characterId);
  },
};

const config = loadConfig(runtime);
const database = new VehiclesDatabase(config.databaseFile);
const vehicles = new VehiclesService(database, config, core, runtime);
const requestTimes = new Map();

function result(work) {
  try {
    return { ok: true, data: work() };
  } catch (error) {
    if (error instanceof VehiclesError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }
    runtime.log('error', error?.stack || String(error));
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'the vehicle resource could not complete the operation',
      },
    };
  }
}

function translate(key, replacements, fallback) {
  try {
    const handler = globalThis.exports.varde_core.Locale;
    if (typeof handler === 'function') {
      return handler(key, replacements, fallback);
    }
  } catch {
    // Older core during a rolling restart: keep the English fallback.
  }
  return fallback;
}

function notify(source, text, kind = 'info', code = null) {
  if (Number(source) > 0) {
    runtime.emitClient(
      Number(source),
      'varde_vehicles:client:message',
      String(text),
      kind,
      code,
    );
  } else {
    runtime.log(kind === 'error' ? 'error' : 'info', String(text));
  }
}

function handle(source, work) {
  const response = result(work);
  if (!response.ok) {
    notify(source, response.error.message, 'error', response.error.code);
  }
  return response;
}

function rateLimit(source, key, interval) {
  const id = `${source}:${key}`;
  const now = Date.now();
  if (now - (requestTimes.get(id) || 0) < interval) {
    return false;
  }
  requestTimes.set(id, now);
  return true;
}

function playerPed(source) {
  const ped = Number(GetPlayerPed(String(source)));
  if (!Number.isSafeInteger(ped) || ped <= 0) {
    throw new VehiclesError('PLAYER_PED_MISSING', 'player ped is unavailable');
  }
  return ped;
}

function coordinates(entity) {
  const value = GetEntityCoords(entity);
  return {
    x: Number(value?.x ?? value?.[0]),
    y: Number(value?.y ?? value?.[1]),
    z: Number(value?.z ?? value?.[2]),
  };
}

function entityFromNetwork(networkId) {
  const entity = Number(NetworkGetEntityFromNetworkId(Number(networkId)));
  if (
    !Number.isSafeInteger(entity) ||
    entity <= 0 ||
    !DoesEntityExist(entity)
  ) {
    throw new VehiclesError('ENTITY_NOT_FOUND', 'network vehicle was not found');
  }
  return entity;
}

function requireSpawnClear(position, radius = 4) {
  for (const entity of GetAllVehicles()) {
    if (Number(entity) > 0 && DoesEntityExist(entity)) {
      const current = coordinates(entity);
      const dx = current.x - position.x;
      const dy = current.y - position.y;
      const dz = current.z - position.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < radius) {
        throw new VehiclesError(
          'SPAWN_BLOCKED',
          'garage spawn point is occupied',
        );
      }
    }
  }
}

function registerTrunk(vehicle) {
  const response = globalThis.exports.varde_inventory.RegisterContainer(
    `vehicle:${vehicle.id}`,
    'vehicle',
    vehicle.id,
    `${vehicle.plate} trunk`,
    config.trunkSlots,
    config.trunkMaxWeight,
  );
  if (!response?.ok) {
    throw new VehiclesError(
      'TRUNK_REGISTRATION_FAILED',
      response?.error?.message || 'vehicle trunk could not be registered',
    );
  }
}

function registerOwned(identifier, input) {
  const vehicle = vehicles.registerVehicle(identifier, input);
  try {
    registerTrunk(vehicle);
    syncIfOnline(identifier);
    return vehicle;
  } catch (error) {
    database.deleteVehicle(vehicle.id);
    throw error;
  }
}

function syncIfOnline(identifier) {
  try {
    vehicles.sync(identifier);
  } catch {
    // Offline character updates are persisted and sync on next login.
  }
}

function spawnFor(source, vehicleId, garageId) {
  const prepared = vehicles.prepareSpawn(
    source,
    vehicleId,
    garageId,
    coordinates(playerPed(source)),
  );
  const spawn = prepared.garage.spawn;
  requireSpawnClear(spawn);
  const entity = Number(
    CreateVehicleServerSetter(
      prepared.vehicle.modelHash,
      prepared.vehicle.vehicleType,
      spawn.x,
      spawn.y,
      spawn.z,
      spawn.heading,
    ),
  );
  if (
    !Number.isSafeInteger(entity) ||
    entity <= 0 ||
    !DoesEntityExist(entity)
  ) {
    throw new VehiclesError('SPAWN_FAILED', 'server could not create the vehicle');
  }

  try {
    SetEntityOrphanMode(entity, 2);
    SetVehicleNumberPlateText(entity, prepared.vehicle.plate);
    SetVehicleDoorsLocked(entity, prepared.vehicle.locked ? 2 : 1);
    Entity(entity).state.set(
      'varde:initVehicle',
      {
        plate: prepared.vehicle.plate,
        locked: prepared.vehicle.locked,
        properties: prepared.vehicle.properties,
      },
      true,
    );
    const networkId = Number(NetworkGetNetworkIdFromEntity(entity));
    const vehicle = vehicles.markSpawned(
      prepared.vehicle.id,
      prepared.garage.id,
      networkId,
    );
    runtime.emitClient(
      source,
      'varde_vehicles:client:spawned',
      networkId,
      vehicle,
    );
    vehicles.sync(source);
    return vehicle;
  } catch (error) {
    DeleteEntity(entity);
    throw error;
  }
}

const recovered = database.recoverOut();
for (const vehicle of database.listAll()) {
  registerTrunk(vehicle);
}
if (recovered > 0) {
  runtime.log('info', `recovered ${recovered} active vehicle(s) into storage`);
}

on('varde:server:playerLoaded', (source) => {
  handle(source, () => vehicles.sync(Number(source)));
});

on('varde:server:characterDeleted', (_source, characterId) => {
  const owned = database
    .listAll()
    .filter((vehicle) => vehicle.ownerCharacterId === characterId);
  handle(0, () => vehicles.deleteCharacter(characterId));
  for (const vehicle of owned) {
    const response = globalThis.exports.varde_inventory.DeleteContainer(
      `vehicle:${vehicle.id}`,
    );
    if (!response?.ok) {
      runtime.log(
        'warn',
        `could not delete trunk for ${vehicle.id}: ${
          response?.error?.message || 'unknown error'
        }`,
      );
    }
  }
});

onNet('varde_vehicles:server:request', () => {
  const source = Number(global.source);
  if (rateLimit(source, 'request', 500)) {
    handle(source, () => vehicles.sync(source));
  }
});

onNet('varde_vehicles:server:spawn', (vehicleId, garageId) => {
  const source = Number(global.source);
  if (rateLimit(source, 'spawn', 1500)) {
    handle(source, () => spawnFor(source, vehicleId, garageId));
  }
});

onNet('varde_vehicles:server:store', (networkId, garageId, properties) => {
  const source = Number(global.source);
  if (!rateLimit(source, 'store', 1000)) {
    return;
  }
  handle(source, () => {
    const ped = playerPed(source);
    const entity = entityFromNetwork(networkId);
    if (Number(GetPedInVehicleSeat(entity, -1)) !== ped) {
      throw new VehiclesError(
        'DRIVER_REQUIRED',
        'you must be the driver to store this vehicle',
      );
    }
    const prepared = vehicles.prepareStore(
      source,
      networkId,
      garageId,
      coordinates(ped),
    );
    DeleteEntity(entity);
    const vehicle = vehicles.markStored(
      prepared.vehicle.id,
      prepared.garage.id,
      properties,
    );
    vehicles.sync(source);
    return vehicle;
  });
});

onNet('varde_vehicles:server:trunk', (networkId) => {
  const source = Number(global.source);
  if (!rateLimit(source, 'trunk', 750)) {
    return;
  }
  handle(source, () => {
    const ped = playerPed(source);
    const entity = entityFromNetwork(networkId);
    const access = vehicles.prepareEntityAccess(
      source,
      networkId,
      coordinates(ped),
      coordinates(entity),
    );
    const response = globalThis.exports.varde_inventory.OpenInventory(
      source,
      `vehicle:${access.vehicle.id}`,
    );
    if (!response?.ok) {
      throw new VehiclesError(
        'TRUNK_OPEN_FAILED',
        response?.error?.message || 'vehicle trunk could not be opened',
      );
    }
    return true;
  });
});

onNet('varde_vehicles:server:toggleLock', (networkId) => {
  const source = Number(global.source);
  if (!rateLimit(source, 'lock', 500)) {
    return;
  }
  handle(source, () => {
    const ped = playerPed(source);
    const entity = entityFromNetwork(networkId);
    const vehicle = vehicles.toggleLock(
      source,
      networkId,
      coordinates(ped),
      coordinates(entity),
    );
    SetVehicleDoorsLocked(entity, vehicle.locked ? 2 : 1);
    runtime.emitAll(
      'varde_vehicles:client:lockChanged',
      Number(networkId),
      vehicle.locked,
    );
    notify(
      source,
      vehicle.locked
        ? translate('vehicles.locked', null, 'Vehicle locked.')
        : translate('vehicles.unlocked', null, 'Vehicle unlocked.'),
    );
    return vehicle;
  });
});

onNet('varde_vehicles:server:initialized', (networkId) => {
  const source = Number(global.source);
  if (!rateLimit(source, 'initialized', 250)) {
    return;
  }
  const entity = Number(NetworkGetEntityFromNetworkId(Number(networkId)));
  const vehicle = database.getByNetwork(Number(networkId));
  if (
    vehicle &&
    entity > 0 &&
    DoesEntityExist(entity) &&
    Number(NetworkGetEntityOwner(entity)) === source
  ) {
    Entity(entity).state.set('varde:initVehicle', null, true);
  }
});

RegisterCommand(
  'givevehicle',
  (source, args) => {
    if (
      Number(source) !== 0 &&
      !IsPlayerAceAllowed(String(source), 'varde.vehicles.manage')
    ) {
      notify(
        source,
        translate(
          'vehicles.createDenied',
          null,
          'You do not have permission to create vehicles.',
        ),
        'error',
      );
      return;
    }
    const target = Number(args[0]);
    const model = String(args[1] || '').toLowerCase();
    const vehicleType = String(args[2] || 'automobile').toLowerCase();
    const response = handle(source, () => {
      return registerOwned(target, {
        model,
        modelHash: Number(GetHashKey(model)),
        vehicleType,
      });
    });
    if (response.ok) {
      notify(
        source,
        translate(
          'vehicles.created',
          {
            model: response.data.model,
            plate: response.data.plate,
            source: target,
          },
          `Created ${response.data.model} (${response.data.plate}) for source ${target}.`,
        ),
      );
    }
  },
  false,
);

globalThis.exports('GetVehicles', (identifier) => {
  try {
    return vehicles.list(identifier);
  } catch {
    return [];
  }
});
globalThis.exports('HasKey', (identifier, vehicleId) => {
  try {
    const characterId = vehicles.resolveCharacter(identifier);
    return Boolean(database.getKey(vehicleId, characterId));
  } catch {
    return false;
  }
});
globalThis.exports('RegisterOwnedVehicle', (identifier, details) =>
  result(() => {
    const input = { ...(details || {}) };
    if (!Number.isSafeInteger(Number(input.modelHash))) {
      input.modelHash = Number(GetHashKey(String(input.model || '')));
    }
    return registerOwned(identifier, input);
  }),
);
globalThis.exports('GiveKey', (ownerIdentifier, targetIdentifier, vehicleId) =>
  result(() => {
    const changed = vehicles.giveKey(
      ownerIdentifier,
      targetIdentifier,
      vehicleId,
    );
    syncIfOnline(targetIdentifier);
    return changed;
  }),
);
globalThis.exports('RevokeKey', (ownerIdentifier, targetIdentifier, vehicleId) =>
  result(() => {
    const changed = vehicles.revokeKey(
      ownerIdentifier,
      targetIdentifier,
      vehicleId,
    );
    syncIfOnline(targetIdentifier);
    return changed;
  }),
);
globalThis.exports('SpawnVehicle', (source, vehicleId, garageId) =>
  result(() => spawnFor(Number(source), vehicleId, garageId)),
);

setTimeout(() => {
  for (const player of core.getPlayers()) {
    const source = Number(player.source);
    if (core.getPlayerData(source)) {
      handle(source, () => vehicles.sync(source));
    }
  }
}, 0);

on('playerDropped', () => {
  const source = Number(global.source);
  for (const key of requestTimes.keys()) {
    if (key.startsWith(`${source}:`)) {
      requestTimes.delete(key);
    }
  }
});

on('onResourceStop', (stoppedResource) => {
  if (stoppedResource !== resourceName) {
    return;
  }
  for (const vehicle of database.listAll()) {
    if (vehicle.networkId) {
      const entity = Number(NetworkGetEntityFromNetworkId(vehicle.networkId));
      if (entity > 0 && DoesEntityExist(entity)) {
        DeleteEntity(entity);
      }
    }
  }
  database.close();
});

runtime.log(
  'info',
  `started with ${Object.keys(config.garages).length} configured garages`,
);
