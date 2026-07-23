'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VehiclesDatabase } = require('../server/database');

function createDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-vehicles-db-'));
  const database = new VehiclesDatabase(path.join(directory, 'vehicles.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

test('vehicle ownership, keys, and lifecycle persist', (t) => {
  const database = createDatabase(t);
  const vehicle = database.createVehicle({
    id: 'veh_0123456789abcdef',
    ownerCharacterId: 'vrd_0123456789abcdef',
    model: 'sultan',
    modelHash: 123,
    vehicleType: 'automobile',
    plate: 'VR123456',
    garageId: 'motelgarage',
    properties: { fuelLevel: 80 },
  });

  assert.equal(vehicle.state, 'stored');
  assert.equal(
    database.getKey(vehicle.id, 'vrd_0123456789abcdef'),
    'owner',
  );
  database.addKey(vehicle.id, 'vrd_fedcba9876543210');
  assert.equal(
    database.listAccessible('vrd_fedcba9876543210').length,
    1,
  );

  database.markOut(vehicle.id, 'motelgarage', 55);
  assert.equal(database.getByNetwork(55).state, 'out');
  database.markStored(vehicle.id, 'motelgarage', { fuelLevel: 70 });
  assert.equal(database.getVehicle(vehicle.id).networkId, null);
  assert.equal(database.deleteVehicle(vehicle.id), true);
  assert.equal(database.getVehicle(vehicle.id), null);
});

test('character deletion removes owned vehicles and shared keys', (t) => {
  const database = createDatabase(t);
  database.createVehicle({
    id: 'veh_0123456789abcdef',
    ownerCharacterId: 'vrd_0123456789abcdef',
    model: 'sultan',
    modelHash: 123,
    vehicleType: 'automobile',
    plate: 'VR123456',
    garageId: 'motelgarage',
    properties: {},
  });
  const removed = database.deleteCharacter('vrd_0123456789abcdef');
  assert.equal(removed.vehicles, 1);
  assert.equal(database.getVehicle('veh_0123456789abcdef'), null);
});
