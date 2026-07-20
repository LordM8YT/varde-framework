'use strict';

const { FrameworkDatabase } = require('./database');
const { FrameworkError } = require('./errors');
const { loadConfig } = require('./config');
const { CoreService } = require('./service');
const { RpcServer } = require('./rpc');

const resourceName = GetCurrentResourceName();

const runtime = {
  resourcePath: GetResourcePath(resourceName),
  loadResourceFile(relativePath) {
    return LoadResourceFile(resourceName, relativePath);
  },
  getConvarInt(name, fallback) {
    return GetConvarInt(name, fallback);
  },
  emitClient(source, eventName, ...args) {
    emitNet(eventName, source, ...args);
  },
  setPlayerState(source, key, value, replicated) {
    Player(String(source)).state.set(key, value, replicated);
  },
  log(level, message) {
    const output = `[varde_core] [${level}] ${message}`;
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
const database = new FrameworkDatabase(config.databaseFile);
const core = new CoreService(database, config, runtime);
const rpc = new RpcServer(runtime);

function getIdentifiers(source) {
  const identifiers = [];
  const count = GetNumPlayerIdentifiers(String(source));
  for (let index = 0; index < count; index += 1) {
    const identifier = GetPlayerIdentifier(String(source), index);
    if (identifier && !identifier.startsWith('ip:')) {
      identifiers.push(identifier);
    }
  }
  return identifiers;
}

function primaryIdentifier(identifiers) {
  return (
    identifiers.find((identifier) => identifier.startsWith('license2:')) ||
    identifiers.find((identifier) => identifier.startsWith('license:')) ||
    null
  );
}

function prepareSource(source, displayName) {
  const identifiers = getIdentifiers(source);
  const identifier = primaryIdentifier(identifiers);
  return core.attachConnection(
    source,
    identifier,
    identifiers,
    displayName || GetPlayerName(String(source)) || 'unknown',
  );
}

function ensurePrepared(source) {
  try {
    core.requireContext(source);
  } catch (error) {
    if (!(error instanceof FrameworkError) || error.code !== 'NOT_READY') {
      throw error;
    }
    prepareSource(source);
  }
}

function exportResult(work) {
  try {
    return {
      ok: true,
      data: work(),
    };
  } catch (error) {
    if (error instanceof FrameworkError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }
    runtime.log('error', error?.stack || String(error));
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'the core could not complete the operation',
      },
    };
  }
}

rpc.register('characters:list', (source) => {
  ensurePrepared(source);
  return core.listCharacters(source);
});
rpc.register('characters:bootstrap', (source) => {
  ensurePrepared(source);
  return core.characterBootstrap(source);
});
rpc.register(
  'characters:create',
  (source, payload) => {
    ensurePrepared(source);
    return core.createCharacter(source, payload);
  },
  { limit: 3, windowMs: 60_000 },
);
rpc.register(
  'characters:delete',
  (source, payload) => {
    ensurePrepared(source);
    return core.deleteCharacter(
      source,
      payload.characterId,
      payload.confirmation,
    );
  },
  { limit: 2, windowMs: 60_000 },
);
rpc.register('characters:select', (source, payload) => {
  ensurePrepared(source);
  return core.selectCharacter(source, payload.characterId);
});
rpc.register('session:current', (source) => {
  ensurePrepared(source);
  return core.getPlayerData(source);
});
rpc.register('session:logout', (source) => core.logout(source), {
  limit: 3,
  windowMs: 10_000,
});

onNet('varde:server:rpc', (requestId, method, payload) => {
  rpc.handle(Number(global.source), requestId, method, payload);
});

onNet('varde:server:updatePosition', (position) => {
  const playerSource = Number(global.source);
  try {
    if (!rpc.rateLimiter.allow(`${playerSource}:position`, 8, 60_000)) {
      return;
    }
    core.updatePosition(playerSource, position);
  } catch (error) {
    if (!(error instanceof FrameworkError)) {
      runtime.log('error', error?.stack || String(error));
    }
  }
});

on('playerConnecting', (name, _setKickReason, deferrals) => {
  const playerSource = Number(global.source);
  const identifiers = getIdentifiers(playerSource);
  const identifier = primaryIdentifier(identifiers);
  deferrals.defer();

  setTimeout(() => {
    try {
      deferrals.update('Preparing your Varde Framework account...');
      core.attachConnection(
        playerSource,
        identifier,
        identifiers,
        name,
      );
      deferrals.done();
    } catch (error) {
      const message =
        error instanceof FrameworkError
          ? error.message
          : 'Varde Framework could not prepare your account.';
      runtime.log('error', error?.stack || String(error));
      deferrals.done(message);
    }
  }, 0);
});

on('playerJoining', (oldSource) => {
  core.moveSource(Number(oldSource), Number(global.source));
});

on('playerDropped', () => {
  const playerSource = Number(global.source);
  try {
    core.drop(playerSource);
  } catch (error) {
    runtime.log('error', error?.stack || String(error));
  } finally {
    rpc.drop(playerSource);
  }
});

exports('GetPlayerData', (identifier) => core.getPlayerData(identifier));
exports('DeleteCharacter', (source, characterId, confirmation) =>
  exportResult(() => {
    ensurePrepared(source);
    return core.deleteCharacter(source, characterId, confirmation);
  }),
);
exports('AddMoney', (identifier, currency, amount, reason, reference) =>
  exportResult(() =>
    core.changeMoney(
      identifier,
      currency,
      amount,
      'add',
      reason,
      reference,
      GetInvokingResource() || 'console',
    ),
  ),
);
exports('RemoveMoney', (identifier, currency, amount, reason, reference) =>
  exportResult(() =>
    core.changeMoney(
      identifier,
      currency,
      amount,
      'remove',
      reason,
      reference,
      GetInvokingResource() || 'console',
    ),
  ),
);
exports('SetMoney', (identifier, currency, amount, reason, reference) =>
  exportResult(() =>
    core.setMoney(
      identifier,
      currency,
      amount,
      reason,
      reference,
      GetInvokingResource() || 'console',
    ),
  ),
);
exports('SetMetadata', (identifier, key, value) =>
  exportResult(() => core.setMetadata(identifier, key, value)),
);
exports('SetJob', (identifier, job) =>
  exportResult(() => core.setJob(identifier, job)),
);
exports('SavePlayer', (identifier) =>
  exportResult(() => core.save(identifier)),
);

const saveTimer = setInterval(() => {
  try {
    const saved = core.saveAll();
    if (saved > 0) {
      runtime.log('info', `autosaved ${saved} active character(s)`);
    }
  } catch (error) {
    runtime.log('error', error?.stack || String(error));
  }
}, config.saveIntervalMs);

on('onResourceStop', (stoppedResource) => {
  if (stoppedResource !== resourceName) {
    return;
  }
  clearInterval(saveTimer);
  try {
    core.saveAll();
  } finally {
    database.close();
  }
});

runtime.log(
  'info',
  `started with SQLite at ${config.databaseFile} and ${config.maxCharacters} character slots`,
);
