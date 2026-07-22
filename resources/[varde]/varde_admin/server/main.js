'use strict';

const { AdminDatabase } = require('./database');
const { AdminError, adminError } = require('./errors');
const { loadConfig } = require('./config');
const { AdminService } = require('./service');

const resourceName = GetCurrentResourceName();
const runtime = {
  resourcePath: GetResourcePath(resourceName),
  loadResourceFile(relativePath) {
    return LoadResourceFile(resourceName, relativePath);
  },
  isAceAllowed(source, permission) {
    return IsPlayerAceAllowed(String(source), permission);
  },
  getPlayers() {
    return globalThis.exports.varde_core
      .GetPlayers()
      .map((player) => Number(player.source));
  },
  getPlayerName(source) {
    return GetPlayerName(String(source)) || `Source ${source}`;
  },
  getPlayerPing(source) {
    return Number(GetPlayerPing(String(source))) || 0;
  },
  getPlayerCoordinates(source) {
    const ped = GetPlayerPed(String(source));
    if (!ped) {
      return null;
    }
    const coordinates = GetEntityCoords(ped);
    return {
      x: Number(coordinates[0] ?? coordinates.x),
      y: Number(coordinates[1] ?? coordinates.y),
      z: Number(coordinates[2] ?? coordinates.z),
    };
  },
  dropPlayer(source, reason) {
    DropPlayer(String(source), reason);
  },
  emitClient(source, eventName, ...args) {
    emitNet(eventName, source, ...args);
  },
  log(level, message) {
    const output = `[varde_admin] [${level}] ${message}`;
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  },
};

function requireResource(name) {
  if (GetResourceState(name) !== 'started') {
    throw adminError(
      'INTEGRATION_UNAVAILABLE',
      `${name} must be started for this action`,
    );
  }
}

const integrations = {
  core: {
    getPlayerData(identifier) {
      return globalThis.exports.varde_core.GetPlayerData(identifier);
    },
    setMoney(identifier, currency, amount, reason, reference) {
      return globalThis.exports.varde_core.SetMoney(
        identifier,
        currency,
        amount,
        reason,
        reference,
      );
    },
  },
  jobs: {
    assignJob(identifier, jobName, grade) {
      requireResource('varde_jobs');
      return globalThis.exports.varde_jobs.AssignJob(
        identifier,
        jobName,
        grade,
      );
    },
  },
  inventory: {
    addItem(identifier, itemName, amount, metadata) {
      requireResource('varde_inventory');
      return globalThis.exports.varde_inventory.AddItem(
        identifier,
        itemName,
        amount,
        metadata,
      );
    },
  },
};

const config = loadConfig(runtime);
const database = new AdminDatabase(config.databaseFile);
database.prune(config.auditRetentionDays);
const admin = new AdminService(database, integrations, runtime);
const requestHistory = new Map();

function allowRequest(source) {
  const now = Date.now();
  const cutoff = now - config.requestWindowMs;
  const history = (requestHistory.get(source) || []).filter(
    (timestamp) => timestamp > cutoff,
  );
  if (history.length >= config.requestLimit) {
    requestHistory.set(source, history);
    return false;
  }
  history.push(now);
  requestHistory.set(source, history);
  return true;
}

function response(work) {
  try {
    return { ok: true, data: work() };
  } catch (error) {
    if (error instanceof AdminError) {
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
        message: 'the admin resource could not complete the operation',
      },
    };
  }
}

onNet('varde_admin:server:request', (requestId, method, payload) => {
  const source = Number(global.source);
  let result;
  if (!allowRequest(source)) {
    result = {
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'too many admin requests' },
    };
  } else {
    let size = Infinity;
    try {
      size = Buffer.byteLength(JSON.stringify(payload || {}), 'utf8');
    } catch {
      size = Infinity;
    }
    result =
      size <= 8192
        ? response(() => admin.execute(source, method, payload || {}))
        : {
            ok: false,
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'admin request payload is too large',
            },
          };
  }
  runtime.emitClient(
    source,
    'varde_admin:client:response',
    String(requestId || '').slice(0, 96),
    result,
  );
});

on('playerDropped', () => {
  const source = Number(global.source);
  admin.playerDropped(source);
  requestHistory.delete(source);
});

globalThis.exports('HasPermission', (source, permission) =>
  admin.hasPermission(Number(source), String(permission || 'varde.admin')),
);

on('onResourceStop', (stoppedResource) => {
  if (stoppedResource === resourceName) {
    database.close();
    runtime.log('info', 'stopped and closed the audit database');
  }
});

runtime.log('info', 'started with ACE enforcement and persistent audit logging');
