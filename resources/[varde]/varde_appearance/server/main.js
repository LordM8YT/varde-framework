'use strict';

const { AppearanceDatabase } = require('./database');
const { AppearanceError } = require('./errors');
const { loadConfig } = require('./config');
const { AppearanceService } = require('./service');

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
    const output = `[varde_appearance] [${level}] ${message}`;
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
const database = new AppearanceDatabase(config.databaseFile);
const appearance = new AppearanceService(database, config, core, runtime);
const requestTimes = new Map();

function result(work) {
  try {
    return { ok: true, data: work() };
  } catch (error) {
    if (error instanceof AppearanceError) {
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
        message: 'the appearance resource could not complete the operation',
      },
    };
  }
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

function notifyError(source, response) {
  if (!response.ok) {
    runtime.emitClient(
      Number(source),
      'varde_appearance:client:error',
      response.error.message,
      response.error.code,
    );
  }
  return response;
}

function syncIfOnline(identifier) {
  try {
    appearance.sync(identifier);
  } catch {
    // Offline saves are delivered when the character logs in.
  }
}

on('varde:server:playerLoaded', (source) => {
  notifyError(source, result(() => appearance.sync(Number(source))));
});

on('varde:server:characterDeleted', (_source, characterId) => {
  appearance.deleteCharacter(characterId);
});

onNet('varde_appearance:server:request', () => {
  const source = Number(global.source);
  if (rateLimit(source, 'request', 500)) {
    notifyError(source, result(() => appearance.sync(source)));
  }
});

onNet('varde_appearance:server:save', (value) => {
  const source = Number(global.source);
  if (!rateLimit(source, 'save', 1000)) {
    return;
  }
  const response = notifyError(
    source,
    result(() => appearance.save(source, value)),
  );
  if (response.ok) {
    runtime.emitClient(
      source,
      'varde_appearance:client:update',
      response.data,
    );
  }
});

onNet('varde_appearance:server:reset', () => {
  const source = Number(global.source);
  if (!rateLimit(source, 'reset', 1500)) {
    return;
  }
  const response = notifyError(source, result(() => appearance.reset(source)));
  if (response.ok) {
    runtime.emitClient(
      source,
      'varde_appearance:client:update',
      response.data,
    );
  }
});

globalThis.exports('GetAppearance', (identifier) => {
  try {
    return appearance.get(identifier);
  } catch {
    return null;
  }
});
globalThis.exports('SaveAppearance', (identifier, value) =>
  result(() => {
    const saved = appearance.save(identifier, value);
    syncIfOnline(identifier);
    return saved;
  }),
);
globalThis.exports('ResetAppearance', (identifier) =>
  result(() => {
    const reset = appearance.reset(identifier);
    syncIfOnline(identifier);
    return reset;
  }),
);

setTimeout(() => {
  for (const player of core.getPlayers()) {
    const source = Number(player.source);
    if (core.getPlayerData(source)) {
      notifyError(source, result(() => appearance.sync(source)));
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
  if (stoppedResource === resourceName) {
    database.close();
  }
});

runtime.log(
  'info',
  `started with ${config.allowedModels.length} allowed freemode models`,
);
