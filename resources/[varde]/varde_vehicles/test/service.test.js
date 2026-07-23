'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VehiclesDatabase } = require('../server/database');
const { VehiclesService, normalizeProperties } = require('../server/service');
const { validateConfig } = require('../server/config');

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-vehicles-'));
  const database = new VehiclesDatabase(path.join(directory, 'vehicles.sqlite'));
  const players = new Map([
    [7, { characterId: 'vrd_0123456789abcdef' }],
    [8, { characterId: 'vrd_fedcba9876543210' }],
  ]);
  const events = [];
  const core = {
    getPlayerData(identifier) {
      if (typeof identifier === 'string' && identifier.startsWith('vrd_')) {
        return (
          [...players.values()].find(
            (player) => player.characterId === identifier,
          ) || null
        );
      }
      return players.get(Number(identifier)) || null;
    },
    getPlayerSource(characterId) {
      for (const [source, player] of players) {
        if (player.characterId === characterId) {
          return source;
        }
      }
      return 0;
    },
  };
  const config = validateConfig(
    {
      databaseFile: 'vehicles.sqlite',
      interactionDistance: 3,
      entityDistance: 6,
      garages: {
        motelgarage: {
          label: 'Motel Parking',
          menu: { x: 10, y: 20, z: 30 },
          spawn: { x: 12, y: 20, z: 30, heading: 90 },
          store: { x: 14, y: 20, z: 30 },
        },
      },
    },
    directory,
  );
  const service = new VehiclesService(database, config, core, {
    emitClient(source, eventName, payload) {
      events.push({ source, eventName, payload });
    },
  });
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, service, events };
}

test('vehicle properties are canonical and bounded', () => {
  assert.deepEqual(normalizeProperties({ z: 1, a: { y: 2, x: 3 } }), {
    a: { x: 3, y: 2 },
    z: 1,
  });
  assert.throws(() => normalizeProperties({ invalid: Number.NaN }), {
    code: 'PROPERTIES_INVALID',
  });
});

test('ownership, sharing, spawn, store, and lock flow is authoritative', (t) => {
  const { service, database, events } = harness(t);
  const vehicle = service.registerVehicle(7, {
    model: 'sultan',
    modelHash: 123,
    vehicleType: 'automobile',
    garageId: 'motelgarage',
    plate: 'TEST123',
    properties: { primaryColor: 1 },
  });
  assert.equal(service.list(7)[0].keyRole, 'owner');
  assert.equal(service.list(8).length, 0);

  service.giveKey(7, 8, vehicle.id);
  assert.equal(service.list(8)[0].keyRole, 'shared');
  const prepared = service.prepareSpawn(
    8,
    vehicle.id,
    'motelgarage',
    { x: 10, y: 20, z: 30 },
  );
  assert.equal(prepared.vehicle.id, vehicle.id);
  service.markSpawned(vehicle.id, 'motelgarage', 99);

  const access = service.prepareEntityAccess(
    8,
    99,
    { x: 1, y: 1, z: 1 },
    { x: 2, y: 1, z: 1 },
  );
  assert.equal(access.vehicle.id, vehicle.id);
  const locked = service.toggleLock(
    8,
    99,
    { x: 1, y: 1, z: 1 },
    { x: 2, y: 1, z: 1 },
  );
  assert.equal(locked.locked, false);

  service.prepareStore(
    8,
    99,
    'motelgarage',
    { x: 14, y: 20, z: 30 },
  );
  const stored = service.markStored(vehicle.id, 'motelgarage', {
    fuelLevel: 40,
    primaryColor: 99,
  });
  assert.equal(stored.state, 'stored');
  assert.equal(stored.properties.fuelLevel, 40);
  assert.equal(stored.properties.primaryColor, 1);

  service.sync(8);
  assert.equal(events.at(-1).eventName, 'varde_vehicles:client:update');
  assert.equal(database.getByNetwork(99), null);
});

test('garage and entity distance checks reject remote actions', (t) => {
  const { service } = harness(t);
  const vehicle = service.registerVehicle(7, {
    model: 'sultan',
    modelHash: 123,
    garageId: 'motelgarage',
  });
  assert.throws(
    () =>
      service.prepareSpawn(7, vehicle.id, 'motelgarage', {
        x: 100,
        y: 100,
        z: 100,
      }),
    { code: 'GARAGE_TOO_FAR' },
  );
});
