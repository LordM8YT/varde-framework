'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { vehiclesError } = require('./errors');

function nowIso() {
  return new Date().toISOString();
}

function hydrate(row) {
  if (!row) {
    return null;
  }
  let properties = {};
  try {
    properties = JSON.parse(row.properties_json);
  } catch {
    properties = {};
  }
  return {
    id: row.id,
    ownerCharacterId: row.owner_character_id,
    model: row.model,
    modelHash: Number(row.model_hash),
    vehicleType: row.vehicle_type,
    plate: row.plate,
    garageId: row.garage_id,
    state: row.state,
    locked: Number(row.locked) === 1,
    properties,
    networkId: row.network_id === null ? null : Number(row.network_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class VehiclesDatabase {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
    this.migrate();
    this.prepare();
  }

  migrate() {
    const version = Number(
      this.database.prepare('PRAGMA user_version').get().user_version,
    );
    if (version > 1) {
      throw vehiclesError(
        'DATABASE_NEWER',
        `database schema ${version} is newer than this resource supports`,
      );
    }
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE vehicles (
          id TEXT PRIMARY KEY,
          owner_character_id TEXT NOT NULL,
          model TEXT NOT NULL,
          model_hash INTEGER NOT NULL,
          vehicle_type TEXT NOT NULL,
          plate TEXT NOT NULL UNIQUE,
          garage_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('stored', 'out', 'impounded')),
          locked INTEGER NOT NULL DEFAULT 1 CHECK (locked IN (0, 1)),
          properties_json TEXT NOT NULL,
          network_id INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX vehicles_owner_idx
          ON vehicles(owner_character_id, created_at);
        CREATE UNIQUE INDEX vehicles_network_idx
          ON vehicles(network_id) WHERE network_id IS NOT NULL;

        CREATE TABLE vehicle_keys (
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          character_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('owner', 'shared')),
          created_at TEXT NOT NULL,
          PRIMARY KEY (vehicle_id, character_id)
        ) STRICT;

        CREATE INDEX vehicle_keys_character_idx
          ON vehicle_keys(character_id, vehicle_id);

        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  prepare() {
    this.statements = {
      insertVehicle: this.database.prepare(`
        INSERT INTO vehicles (
          id, owner_character_id, model, model_hash, vehicle_type, plate,
          garage_id, state, locked, properties_json, network_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'stored', 1, ?, NULL, ?, ?)
      `),
      getVehicle: this.database.prepare('SELECT * FROM vehicles WHERE id = ?'),
      getByPlate: this.database.prepare('SELECT * FROM vehicles WHERE plate = ?'),
      getByNetwork: this.database.prepare(
        'SELECT * FROM vehicles WHERE network_id = ?',
      ),
      listAll: this.database.prepare(
        'SELECT * FROM vehicles ORDER BY created_at ASC',
      ),
      listAccessible: this.database.prepare(`
        SELECT v.* FROM vehicles v
        INNER JOIN vehicle_keys k ON k.vehicle_id = v.id
        WHERE k.character_id = ?
        ORDER BY v.created_at ASC
      `),
      addKey: this.database.prepare(`
        INSERT INTO vehicle_keys (vehicle_id, character_id, role, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(vehicle_id, character_id)
        DO UPDATE SET role = excluded.role
      `),
      getKey: this.database.prepare(`
        SELECT role FROM vehicle_keys
        WHERE vehicle_id = ? AND character_id = ?
      `),
      removeKey: this.database.prepare(`
        DELETE FROM vehicle_keys
        WHERE vehicle_id = ? AND character_id = ? AND role != 'owner'
      `),
      markOut: this.database.prepare(`
        UPDATE vehicles
        SET state = 'out', garage_id = ?, network_id = ?, updated_at = ?
        WHERE id = ?
      `),
      markStored: this.database.prepare(`
        UPDATE vehicles
        SET state = 'stored', garage_id = ?, network_id = NULL,
          properties_json = ?, updated_at = ?
        WHERE id = ?
      `),
      setLocked: this.database.prepare(`
        UPDATE vehicles SET locked = ?, updated_at = ? WHERE id = ?
      `),
      recoverOut: this.database.prepare(`
        UPDATE vehicles
        SET state = 'stored', network_id = NULL, updated_at = ?
        WHERE state = 'out'
      `),
      deleteOwned: this.database.prepare(
        'DELETE FROM vehicles WHERE owner_character_id = ?',
      ),
      deleteVehicle: this.database.prepare(
        'DELETE FROM vehicles WHERE id = ?',
      ),
      deleteKeys: this.database.prepare(
        'DELETE FROM vehicle_keys WHERE character_id = ?',
      ),
    };
  }

  createVehicle(value) {
    const timestamp = nowIso();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.statements.insertVehicle.run(
        value.id,
        value.ownerCharacterId,
        value.model,
        value.modelHash,
        value.vehicleType,
        value.plate,
        value.garageId,
        JSON.stringify(value.properties),
        timestamp,
        timestamp,
      );
      this.statements.addKey.run(
        value.id,
        value.ownerCharacterId,
        'owner',
        timestamp,
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.getVehicle(value.id);
  }

  getVehicle(id) {
    return hydrate(this.statements.getVehicle.get(id));
  }

  getByPlate(plate) {
    return hydrate(this.statements.getByPlate.get(plate));
  }

  getByNetwork(networkId) {
    return hydrate(this.statements.getByNetwork.get(networkId));
  }

  listAll() {
    return this.statements.listAll.all().map(hydrate);
  }

  listAccessible(characterId) {
    return this.statements.listAccessible.all(characterId).map(hydrate);
  }

  addKey(vehicleId, characterId, role = 'shared') {
    this.statements.addKey.run(vehicleId, characterId, role, nowIso());
    return this.getKey(vehicleId, characterId);
  }

  getKey(vehicleId, characterId) {
    return this.statements.getKey.get(vehicleId, characterId)?.role || null;
  }

  removeKey(vehicleId, characterId) {
    return Number(
      this.statements.removeKey.run(vehicleId, characterId).changes,
    ) === 1;
  }

  markOut(vehicleId, garageId, networkId) {
    this.statements.markOut.run(garageId, networkId, nowIso(), vehicleId);
    return this.getVehicle(vehicleId);
  }

  markStored(vehicleId, garageId, properties) {
    this.statements.markStored.run(
      garageId,
      JSON.stringify(properties || {}),
      nowIso(),
      vehicleId,
    );
    return this.getVehicle(vehicleId);
  }

  setLocked(vehicleId, locked) {
    this.statements.setLocked.run(locked ? 1 : 0, nowIso(), vehicleId);
    return this.getVehicle(vehicleId);
  }

  recoverOut() {
    return Number(this.statements.recoverOut.run(nowIso()).changes);
  }

  deleteCharacter(characterId) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const vehicles = Number(this.statements.deleteOwned.run(characterId).changes);
      const keys = Number(this.statements.deleteKeys.run(characterId).changes);
      this.database.exec('COMMIT');
      return { vehicles, keys };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  deleteVehicle(vehicleId) {
    return Number(this.statements.deleteVehicle.run(vehicleId).changes) === 1;
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  VehiclesDatabase,
};
