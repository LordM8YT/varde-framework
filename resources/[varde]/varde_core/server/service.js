'use strict';

const { frameworkError } = require('./errors');
const {
  plainObject,
  validateAmount,
  validateCharacterInput,
  validateCurrency,
  validateMetadata,
  validatePosition,
  validateReason,
} = require('./validation');

const CHARACTER_ID_PATTERN = /^vrd_[a-f0-9]{16}$/;
const JOB_NAME_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicSnapshot(character) {
  return {
    characterId: character.characterId,
    slot: character.slot,
    profile: clone(character.profile),
    job: clone(character.job),
    position: clone(character.position),
    money: { ...character.money },
    metadata: clone(character.metadata),
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  };
}

function characterSummary(character) {
  return {
    characterId: character.characterId,
    slot: character.slot,
    profile: clone(character.profile),
    job: clone(character.job),
    createdAt: character.createdAt,
  };
}

function normalizeSource(source) {
  const normalized = Number(source);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw frameworkError('SOURCE_INVALID', 'player source is invalid');
  }
  return normalized;
}

function validateCharacterId(value) {
  if (typeof value !== 'string' || !CHARACTER_ID_PATTERN.test(value)) {
    throw frameworkError('VALIDATION_ERROR', 'characterId is invalid');
  }
  return value;
}

function validateJob(value) {
  if (!plainObject(value)) {
    throw frameworkError('VALIDATION_ERROR', 'job must be an object');
  }

  const name = String(value.name || '').trim();
  const label = String(value.label || '').trim();
  const grade = Number(value.grade);
  if (!JOB_NAME_PATTERN.test(name)) {
    throw frameworkError('VALIDATION_ERROR', 'job.name is invalid');
  }
  if (!label || label.length > 64) {
    throw frameworkError('VALIDATION_ERROR', 'job.label must contain 1-64 characters');
  }
  if (!Number.isSafeInteger(grade) || grade < 0 || grade > 1000) {
    throw frameworkError('VALIDATION_ERROR', 'job.grade must be between 0 and 1000');
  }

  return {
    name,
    label,
    grade,
    onDuty: value.onDuty === true,
  };
}

class CoreService {
  constructor(database, config, runtime) {
    this.database = database;
    this.config = config;
    this.runtime = runtime;
    this.contexts = new Map();
  }

  attachConnection(source, primaryIdentifier, identifiers, displayName) {
    const playerSource = normalizeSource(source);
    if (typeof primaryIdentifier !== 'string' || !primaryIdentifier) {
      throw frameworkError('IDENTIFIER_MISSING', 'a Rockstar license is required');
    }

    const account = this.database.upsertAccount(
      primaryIdentifier,
      identifiers,
      displayName,
    );

    for (const [otherSource, context] of this.contexts) {
      if (
        otherSource !== playerSource &&
        context.account.id === account.id
      ) {
        throw frameworkError(
          'ALREADY_CONNECTED',
          'this Rockstar account is already connected',
        );
      }
    }

    const current = this.contexts.get(playerSource);
    this.contexts.set(playerSource, {
      account,
      player: current?.player || null,
    });
    return account;
  }

  moveSource(oldSource, newSource) {
    const oldId = Number(oldSource);
    const newId = normalizeSource(newSource);
    if (oldId === newId) {
      return;
    }
    const context = this.contexts.get(oldId);
    if (!context) {
      return;
    }
    this.contexts.delete(oldId);
    if (context.player) {
      context.player.source = newId;
    }
    this.contexts.set(newId, context);
  }

  requireContext(source) {
    const playerSource = normalizeSource(source);
    const context = this.contexts.get(playerSource);
    if (!context) {
      throw frameworkError('NOT_READY', 'player account is not ready');
    }
    return { playerSource, context };
  }

  requirePlayer(source) {
    const result = this.requireContext(source);
    if (!result.context.player) {
      throw frameworkError('NOT_LOGGED_IN', 'no character is logged in');
    }
    return {
      ...result,
      player: result.context.player,
    };
  }

  listCharacters(source) {
    const { context } = this.requireContext(source);
    return this.database
      .listCharacters(context.account.id)
      .map(characterSummary);
  }

  createCharacter(source, input) {
    const { context } = this.requireContext(source);
    if (context.player) {
      throw frameworkError(
        'ALREADY_LOGGED_IN',
        'log out before creating another character',
      );
    }
    const profile = validateCharacterInput(input, this.config.maxCharacters);
    const character = this.database.createCharacter(
      context.account.id,
      profile,
      this.config,
    );
    return characterSummary(character);
  }

  selectCharacter(source, characterId) {
    const { playerSource, context } = this.requireContext(source);
    if (context.player) {
      throw frameworkError(
        'ALREADY_LOGGED_IN',
        'a character is already logged in',
      );
    }

    const id = validateCharacterId(characterId);
    const character = this.database.loadOwnedCharacter(context.account.id, id);
    if (!character) {
      throw frameworkError('CHARACTER_NOT_FOUND', 'character was not found');
    }

    character.source = playerSource;
    context.player = character;

    this.setPublicState(playerSource, character);
    const snapshot = publicSnapshot(character);
    this.runtime.emitClient(playerSource, 'varde:client:playerLoaded', snapshot);
    this.runtime.log(
      'info',
      `source ${playerSource} selected character ${character.characterId}`,
    );
    return snapshot;
  }

  logout(source) {
    const { playerSource, context, player } = this.requirePlayer(source);
    this.database.saveCharacter(player);
    context.player = null;
    this.clearPublicState(playerSource);
    this.runtime.emitClient(playerSource, 'varde:client:playerLoggedOut');
    return true;
  }

  drop(source) {
    const playerSource = Number(source);
    const context = this.contexts.get(playerSource);
    if (!context) {
      return;
    }
    if (context.player) {
      this.database.saveCharacter(context.player);
    }
    this.contexts.delete(playerSource);
  }

  getPlayer(identifier) {
    if (typeof identifier === 'number' || /^\d+$/.test(String(identifier))) {
      return this.contexts.get(Number(identifier))?.player || null;
    }
    for (const context of this.contexts.values()) {
      if (context.player?.characterId === identifier) {
        return context.player;
      }
    }
    return null;
  }

  getPlayerData(identifier) {
    const player = this.getPlayer(identifier);
    return player ? publicSnapshot(player) : null;
  }

  changeMoney(identifier, currency, amount, operation, reason, reference, actor) {
    const player = this.getPlayer(identifier);
    if (!player) {
      throw frameworkError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    const wallet = validateCurrency(currency);
    const validAmount = validateAmount(amount);
    const validReason = validateReason(reason);
    const delta = operation === 'remove' ? -validAmount : validAmount;
    const balance = this.database.changeMoney(
      player,
      wallet,
      delta,
      validReason,
      reference,
      String(actor || 'resource').slice(0, 96),
    );
    player.money[wallet] = balance;
    this.syncOwner(player);
    return balance;
  }

  setMoney(identifier, currency, amount, reason, reference, actor) {
    const player = this.getPlayer(identifier);
    if (!player) {
      throw frameworkError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    const wallet = validateCurrency(currency);
    const validAmount = Number(amount);
    if (
      !Number.isSafeInteger(validAmount) ||
      validAmount < 0 ||
      validAmount > 1_000_000_000
    ) {
      throw frameworkError(
        'VALIDATION_ERROR',
        'amount must be an integer between 0 and 1000000000',
      );
    }
    const balance = this.database.setMoney(
      player,
      wallet,
      validAmount,
      validateReason(reason),
      reference,
      String(actor || 'resource').slice(0, 96),
    );
    player.money[wallet] = balance;
    this.syncOwner(player);
    return balance;
  }

  setMetadata(identifier, key, value) {
    const player = this.getPlayer(identifier);
    if (!player) {
      throw frameworkError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    player.metadata[key] = validateMetadata(key, value);
    this.syncOwner(player);
    return clone(player.metadata[key]);
  }

  setJob(identifier, value) {
    const player = this.getPlayer(identifier);
    if (!player) {
      throw frameworkError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    player.job = validateJob(value);
    this.runtime.setPlayerState(
      player.source,
      'varde:job',
      clone(player.job),
      true,
    );
    this.syncOwner(player);
    return clone(player.job);
  }

  updatePosition(source, value) {
    const { player } = this.requirePlayer(source);
    player.position = validatePosition(value);
  }

  save(identifier) {
    const player = this.getPlayer(identifier);
    if (!player) {
      throw frameworkError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    this.database.saveCharacter(player);
    return true;
  }

  saveAll() {
    let saved = 0;
    for (const context of this.contexts.values()) {
      if (context.player) {
        this.database.saveCharacter(context.player);
        saved += 1;
      }
    }
    return saved;
  }

  syncOwner(player) {
    this.runtime.emitClient(
      player.source,
      'varde:client:playerUpdated',
      publicSnapshot(player),
    );
  }

  setPublicState(source, character) {
    this.runtime.setPlayerState(source, 'varde:loaded', true, true);
    this.runtime.setPlayerState(
      source,
      'varde:characterId',
      character.characterId,
      true,
    );
    this.runtime.setPlayerState(source, 'varde:job', clone(character.job), true);
  }

  clearPublicState(source) {
    this.runtime.setPlayerState(source, 'varde:loaded', false, true);
    this.runtime.setPlayerState(source, 'varde:characterId', null, true);
    this.runtime.setPlayerState(source, 'varde:job', null, true);
  }
}

module.exports = {
  CoreService,
  characterSummary,
  publicSnapshot,
  validateCharacterId,
  validateJob,
};
