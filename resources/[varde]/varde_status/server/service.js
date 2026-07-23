'use strict';

const { statusError } = require('./errors');

const CHARACTER_ID_PATTERN = /^vrd_[a-f0-9]{16}$/;
const NEED_NAME_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw statusError(
      'VALIDATION_ERROR',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

class StatusService {
  constructor(database, config, core, runtime) {
    this.database = database;
    this.config = config;
    this.core = core;
    this.runtime = runtime;
    this.active = new Map();
  }

  defaults() {
    return Object.fromEntries(
      Object.entries(this.config.needs).map(([name, definition]) => [
        name,
        definition.default,
      ]),
    );
  }

  normalize(values) {
    const output = {};
    for (const [name, definition] of Object.entries(this.config.needs)) {
      const value = Number(values?.[name]);
      output[name] = Number.isSafeInteger(value)
        ? Math.min(definition.maximum, Math.max(definition.minimum, value))
        : definition.default;
    }
    return output;
  }

  resolveOnline(identifier) {
    const player = this.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw statusError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    const source = Number(
      typeof identifier === 'number' || /^\d+$/u.test(String(identifier))
        ? identifier
        : this.core.getPlayerSource(player.characterId),
    );
    if (!Number.isSafeInteger(source) || source <= 0) {
      throw statusError('PLAYER_NOT_FOUND', 'online player source was not found');
    }
    return { source, characterId: player.characterId };
  }

  ensure(characterId) {
    if (!CHARACTER_ID_PATTERN.test(String(characterId))) {
      throw statusError('VALIDATION_ERROR', 'characterId is invalid');
    }
    const profile = this.database.ensure(characterId, this.defaults());
    const values = this.normalize(profile.values);
    if (JSON.stringify(values) !== JSON.stringify(profile.values)) {
      this.database.save(characterId, values);
    }
    return values;
  }

  publish(source, values) {
    const snapshot = clone(values);
    this.runtime.emitClient(source, 'varde_status:client:update', snapshot);
    return snapshot;
  }

  sync(identifier) {
    const online = this.resolveOnline(identifier);
    const values = this.ensure(online.characterId);
    this.active.set(online.characterId, {
      source: online.source,
      values,
    });
    return this.publish(online.source, values);
  }

  get(identifier) {
    const online = this.resolveOnline(identifier);
    const active = this.active.get(online.characterId);
    return clone(active?.values || this.ensure(online.characterId));
  }

  definition(name) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!NEED_NAME_PATTERN.test(normalized) || !this.config.needs[normalized]) {
      throw statusError('STATUS_NOT_FOUND', 'status need was not found');
    }
    return { name: normalized, definition: this.config.needs[normalized] };
  }

  mutate(identifier, name, amount, operation) {
    const online = this.resolveOnline(identifier);
    const need = this.definition(name);
    const current = this.active.get(online.characterId)?.values ||
      this.ensure(online.characterId);
    const validAmount = integer(amount, 0, 100, 'amount');
    const nextValue =
      operation === 'set'
        ? validAmount
        : current[need.name] + (operation === 'remove' ? -validAmount : validAmount);
    current[need.name] = Math.min(
      need.definition.maximum,
      Math.max(need.definition.minimum, nextValue),
    );
    this.database.save(online.characterId, current);
    this.active.set(online.characterId, {
      source: online.source,
      values: current,
    });
    this.publish(online.source, current);
    return clone(current);
  }

  set(identifier, name, value) {
    return this.mutate(identifier, name, value, 'set');
  }

  add(identifier, name, amount) {
    return this.mutate(identifier, name, amount, 'add');
  }

  remove(identifier, name, amount) {
    return this.mutate(identifier, name, amount, 'remove');
  }

  reset(identifier) {
    const online = this.resolveOnline(identifier);
    const values = this.defaults();
    this.database.ensure(online.characterId, values);
    this.database.save(online.characterId, values);
    this.active.set(online.characterId, {
      source: online.source,
      values,
    });
    this.publish(online.source, values);
    return clone(values);
  }

  tick() {
    let changed = 0;
    for (const player of this.core.getPlayers()) {
      const online = this.resolveOnline(player.source);
      const entry = this.active.get(online.characterId) || {
        source: online.source,
        values: this.ensure(online.characterId),
      };
      let dirty = false;
      for (const [name, definition] of Object.entries(this.config.needs)) {
        if (definition.decay <= 0) {
          continue;
        }
        const next = Math.max(
          definition.minimum,
          entry.values[name] - definition.decay,
        );
        if (next !== entry.values[name]) {
          entry.values[name] = next;
          dirty = true;
        }
      }
      this.active.set(online.characterId, entry);
      if (dirty) {
        this.database.save(online.characterId, entry.values);
        this.publish(online.source, entry.values);
        changed += 1;
      }
    }
    return changed;
  }

  drop(source, characterId) {
    if (CHARACTER_ID_PATTERN.test(String(characterId))) {
      return this.active.delete(characterId);
    }
    for (const [id, entry] of this.active) {
      if (entry.source === Number(source)) {
        return this.active.delete(id);
      }
    }
    return false;
  }

  deleteCharacter(characterId) {
    this.active.delete(String(characterId));
    return CHARACTER_ID_PATTERN.test(String(characterId))
      ? this.database.delete(String(characterId))
      : false;
  }
}

module.exports = {
  StatusService,
};
