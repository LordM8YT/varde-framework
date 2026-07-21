'use strict';

const { PhoneDatabase } = require('./database');
const { PhoneError, phoneError } = require('./errors');
const { loadConfig } = require('./config');
const { PhoneService } = require('./service');

const resourceName = GetCurrentResourceName();
const runtime = {
  resourcePath: GetResourcePath(resourceName),
  loadResourceFile(relativePath) {
    return LoadResourceFile(resourceName, relativePath);
  },
  emitClient(source, eventName, ...args) {
    emitNet(eventName, source, ...args);
  },
  log(level, message) {
    const output = `[varde_phone] [${level}] ${message}`;
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  },
};

const config = loadConfig(runtime);

function requireResource(name) {
  if (GetResourceState(name) !== 'started') {
    throw phoneError(
      'INTEGRATION_UNAVAILABLE',
      `${name} must be started for this operation`,
    );
  }
}

const integrations = {
  core: {
    getPlayerData(identifier) {
      return globalThis.exports.varde_core.GetPlayerData(identifier);
    },
    getPlayerSource(characterId) {
      return globalThis.exports.varde_core.GetPlayerSource(characterId);
    },
  },
  inventory: {
    hasItem(identifier, itemName, amount) {
      requireResource('varde_inventory');
      return globalThis.exports.varde_inventory.HasItem(
        identifier,
        itemName,
        amount,
      );
    },
  },
};

const database = new PhoneDatabase(
  config.databaseFile,
  config.numberPrefix,
  config.numberLength,
);
const phone = new PhoneService(database, config, integrations, runtime);
const requestHistory = new Map();

const limits = {
  'messages:send': { limit: 5, windowMs: 10_000 },
  'messages:list': { limit: 20, windowMs: 10_000 },
  default: { limit: 12, windowMs: 10_000 },
};

function allowRequest(source, method) {
  const rule = limits[method] || limits.default;
  const key = `${source}:${method}`;
  const cutoff = Date.now() - rule.windowMs;
  const history = (requestHistory.get(key) || []).filter(
    (timestamp) => timestamp > cutoff,
  );
  if (history.length >= rule.limit) {
    requestHistory.set(key, history);
    return false;
  }
  history.push(Date.now());
  requestHistory.set(key, history);
  return true;
}

function result(work) {
  try {
    return { ok: true, data: work() };
  } catch (error) {
    if (error instanceof PhoneError) {
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
        message: 'the phone resource could not complete the operation',
      },
    };
  }
}

function handle(source, method, payload) {
  switch (method) {
    case 'bootstrap':
      return phone.bootstrap(source);
    case 'contacts:create':
      return phone.createContact(source, payload);
    case 'contacts:update':
      return phone.updateContact(source, payload);
    case 'contacts:delete':
      return phone.deleteContact(source, payload);
    case 'messages:list':
      return phone.listMessages(source, payload);
    case 'messages:send':
      return phone.send(source, payload);
    default:
      throw phoneError('METHOD_NOT_FOUND', 'phone method was not found');
  }
}

onNet('varde_phone:server:request', (requestId, method, payload) => {
  const source = Number(global.source);
  const name = String(method || '');
  let response;
  if (!allowRequest(source, name)) {
    response = {
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'too many phone requests' },
    };
  } else {
    let size = Infinity;
    try {
      size = Buffer.byteLength(JSON.stringify(payload || {}), 'utf8');
    } catch {
      size = Infinity;
    }
    response =
      size <= 8192
        ? result(() => handle(source, name, payload || {}))
        : {
            ok: false,
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'phone request payload is too large',
            },
          };
  }
  runtime.emitClient(
    source,
    'varde_phone:client:response',
    String(requestId || '').slice(0, 96),
    response,
  );
});

on('varde:server:playerLoaded', (source, snapshot) => {
  try {
    phone.ensureAccount(snapshot.characterId);
  } catch (error) {
    runtime.log('error', error?.stack || String(error));
  }
});

on('varde:server:characterDeleted', (_source, characterId) => {
  try {
    phone.deleteCharacter(characterId);
  } catch (error) {
    runtime.log('error', error?.stack || String(error));
  }
});

on('playerDropped', () => {
  const source = Number(global.source);
  for (const key of requestHistory.keys()) {
    if (key.startsWith(`${source}:`)) {
      requestHistory.delete(key);
    }
  }
});

globalThis.exports('GetPhoneNumber', (identifier) => {
  try {
    return phone.account(identifier).phoneNumber;
  } catch {
    return null;
  }
});
globalThis.exports('SendMessage', (fromIdentifier, toNumber, body) =>
  result(() => phone.sendTrusted(fromIdentifier, toNumber, body)),
);

on('onResourceStop', (stoppedResource) => {
  if (stoppedResource === resourceName) {
    database.close();
  }
});

runtime.log(
  'info',
  `started in text-only mode with ${config.numberLength}-digit numbers`,
);
