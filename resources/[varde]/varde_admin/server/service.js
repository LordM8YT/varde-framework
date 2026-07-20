'use strict';

const { adminError } = require('./errors');

const ACTIONS = Object.freeze({
  bootstrap: 'varde.admin.open',
  'players:list': 'varde.admin.players',
  'player:kick': 'varde.admin.moderation',
  'player:freeze': 'varde.admin.moderation',
  'player:heal': 'varde.admin.moderation',
  'player:goto': 'varde.admin.teleport',
  'player:bring': 'varde.admin.teleport',
  'economy:set': 'varde.admin.economy',
  'job:assign': 'varde.admin.jobs',
  'inventory:add': 'varde.admin.inventory',
  'audit:list': 'varde.admin.audit',
});

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw adminError(
      'VALIDATION_ERROR',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function boundedText(value, minimum, maximum, label) {
  const result = String(value || '').trim();
  if (result.length < minimum || result.length > maximum) {
    throw adminError(
      'VALIDATION_ERROR',
      `${label} must contain ${minimum}-${maximum} characters`,
    );
  }
  return result;
}

function unwrap(result, fallback) {
  if (!result || result.ok !== true) {
    throw adminError(
      result?.error?.code || 'INTEGRATION_ERROR',
      result?.error?.message || fallback,
    );
  }
  return result.data;
}

class AdminService {
  constructor(database, integrations, runtime) {
    this.database = database;
    this.integrations = integrations;
    this.runtime = runtime;
    this.frozen = new Set();
  }

  hasPermission(source, permission) {
    return (
      this.runtime.isAceAllowed(source, 'varde.admin') ||
      this.runtime.isAceAllowed(source, permission)
    );
  }

  permissionSnapshot(source) {
    const permissions = {};
    for (const permission of new Set(Object.values(ACTIONS))) {
      permissions[permission] = this.hasPermission(source, permission);
    }
    return permissions;
  }

  requirePermission(source, method) {
    const permission = ACTIONS[method];
    if (!permission) {
      throw adminError('ACTION_NOT_FOUND', 'admin action was not found');
    }
    if (!this.hasPermission(source, permission)) {
      throw adminError('FORBIDDEN', `missing ACE ${permission}`);
    }
  }

  playerData(source) {
    const target = integer(source, 1, 65535, 'target');
    const player = this.integrations.core.getPlayerData(target);
    if (!player?.characterId) {
      throw adminError('PLAYER_NOT_FOUND', 'online target was not found');
    }
    return { source: target, player };
  }

  publicPlayer(source) {
    const { player } = this.playerData(source);
    const profile = player.profile || {};
    return {
      source: Number(source),
      characterId: player.characterId,
      name: `${profile.firstName || ''} ${profile.lastName || ''}`.trim(),
      serverName: this.runtime.getPlayerName(source),
      ping: this.runtime.getPlayerPing(source),
      job: player.job || null,
      frozen: this.frozen.has(Number(source)),
    };
  }

  listPlayers() {
    const players = [];
    for (const source of this.runtime.getPlayers()) {
      try {
        players.push(this.publicPlayer(Number(source)));
      } catch {
        // Players without a selected Varde character are omitted.
      }
    }
    return players.sort((a, b) => a.source - b.source);
  }

  targetFromPayload(payload) {
    return this.playerData(payload?.target);
  }

  coordinates(source) {
    const coordinates = this.runtime.getPlayerCoordinates(source);
    if (
      !coordinates ||
      ![coordinates.x, coordinates.y, coordinates.z].every(Number.isFinite)
    ) {
      throw adminError('POSITION_UNAVAILABLE', 'player position is unavailable');
    }
    return coordinates;
  }

  perform(source, method, payload = {}) {
    if (method === 'bootstrap') {
      return {
        source,
        permissions: this.permissionSnapshot(source),
        players: this.hasPermission(source, 'varde.admin.players')
          ? this.listPlayers()
          : [],
      };
    }
    if (method === 'players:list') {
      return this.listPlayers();
    }
    if (method === 'audit:list') {
      return this.database.recent(integer(payload.limit ?? 100, 1, 500, 'limit'));
    }

    const target = this.targetFromPayload(payload);
    switch (method) {
      case 'player:kick': {
        const reason = boundedText(
          payload.reason || 'Removed by an administrator.',
          1,
          128,
          'reason',
        );
        this.runtime.dropPlayer(target.source, reason);
        return true;
      }
      case 'player:freeze': {
        const frozen = payload.frozen === true;
        if (frozen) {
          this.frozen.add(target.source);
        } else {
          this.frozen.delete(target.source);
        }
        this.runtime.emitClient(
          target.source,
          'varde_admin:client:setFrozen',
          frozen,
        );
        return { frozen };
      }
      case 'player:heal':
        this.runtime.emitClient(target.source, 'varde_admin:client:heal');
        return true;
      case 'player:goto':
        this.runtime.emitClient(
          source,
          'varde_admin:client:teleport',
          this.coordinates(target.source),
        );
        return true;
      case 'player:bring':
        this.runtime.emitClient(
          target.source,
          'varde_admin:client:teleport',
          this.coordinates(source),
        );
        return true;
      case 'economy:set': {
        const currency = boundedText(payload.currency, 3, 16, 'currency');
        if (!['cash', 'bank'].includes(currency)) {
          throw adminError('VALIDATION_ERROR', 'currency must be cash or bank');
        }
        const amount = integer(payload.amount, 0, 1_000_000_000, 'amount');
        return unwrap(
          this.integrations.core.setMoney(
            target.source,
            currency,
            amount,
            'admin_correction',
            `admin:${source}`,
          ),
          'core rejected the money change',
        );
      }
      case 'job:assign': {
        const jobName = boundedText(payload.jobName, 2, 32, 'jobName');
        const grade = integer(payload.grade ?? 0, 0, 1000, 'grade');
        return unwrap(
          this.integrations.jobs.assignJob(target.source, jobName, grade),
          'jobs resource rejected the assignment',
        );
      }
      case 'inventory:add': {
        const itemName = boundedText(payload.itemName, 2, 48, 'itemName');
        const amount = integer(payload.amount ?? 1, 1, 1_000_000, 'amount');
        return unwrap(
          this.integrations.inventory.addItem(
            target.source,
            itemName,
            amount,
            payload.metadata || {},
          ),
          'inventory resource rejected the item',
        );
      }
      default:
        throw adminError('ACTION_NOT_FOUND', 'admin action was not found');
    }
  }

  execute(source, method, payload = {}) {
    const adminSource = integer(source, 1, 65535, 'source');
    const action = String(method || '');
    const actor = this.integrations.core.getPlayerData(adminSource);
    let target = null;

    try {
      this.requirePermission(adminSource, action);
      if (payload && payload.target !== undefined) {
        try {
          target = this.playerData(payload.target);
        } catch {
          // The attempted target is still captured by source below.
        }
      }
      const data = this.perform(adminSource, action, payload);
      if (action !== 'bootstrap' && action !== 'players:list') {
        this.database.record({
          actorSource: adminSource,
          actorCharacterId: actor?.characterId,
          action,
          targetSource: target?.source || Number(payload?.target) || null,
          targetCharacterId: target?.player?.characterId,
          status: 'success',
          details: this.auditDetails(action, payload),
        });
      }
      return data;
    } catch (error) {
      this.database.record({
        actorSource: adminSource,
        actorCharacterId: actor?.characterId,
        action,
        targetSource: target?.source || Number(payload?.target) || null,
        targetCharacterId: target?.player?.characterId,
        status: 'failure',
        details: {
          ...this.auditDetails(action, payload),
          error: error?.code || 'INTERNAL_ERROR',
        },
      });
      throw error;
    }
  }

  auditDetails(action, payload) {
    switch (action) {
      case 'player:kick':
        return { reason: String(payload.reason || '').slice(0, 128) };
      case 'player:freeze':
        return { frozen: payload.frozen === true };
      case 'economy:set':
        return { currency: payload.currency, amount: Number(payload.amount) };
      case 'job:assign':
        return { jobName: payload.jobName, grade: Number(payload.grade || 0) };
      case 'inventory:add':
        return { itemName: payload.itemName, amount: Number(payload.amount || 1) };
      default:
        return {};
    }
  }

  playerDropped(source) {
    this.frozen.delete(Number(source));
  }
}

module.exports = {
  ACTIONS,
  AdminService,
};
