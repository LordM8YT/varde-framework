'use strict';

const { InventoryDatabase } = require('./database');
const { InventoryError } = require('./errors');
const { loadConfig } = require('./config');
const { InventoryService } = require('./service');

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
    const output = `[varde_inventory] [${level}] ${message}`;
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
const database = new InventoryDatabase(config.databaseFile);
const inventory = new InventoryService(database, config, core, runtime);
const requestTimes = new Map();

function rateLimit(source, key, minimumIntervalMs) {
  const id = `${source}:${key}`;
  const now = Date.now();
  const previous = requestTimes.get(id) || 0;
  if (now - previous < minimumIntervalMs) {
    return false;
  }
  requestTimes.set(id, now);
  return true;
}

function result(work) {
  try {
    return { ok: true, data: work() };
  } catch (error) {
    if (error instanceof InventoryError) {
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
        message: 'the inventory resource could not complete the operation',
      },
    };
  }
}

function notifyError(source, response) {
  if (!response.ok && Number(source) > 0) {
    runtime.emitClient(
      Number(source),
      'varde_inventory:client:error',
      response.error.message,
    );
  }
  return response;
}

function invokingResource() {
  return GetInvokingResource() || 'resource';
}

on('varde:server:playerLoaded', (source) => {
  notifyError(source, result(() => inventory.sync(Number(source))));
});

on('varde:server:characterDeleted', (_source, characterId) => {
  inventory.deleteCharacter(characterId);
});

onNet('varde_inventory:server:request', () => {
  const source = Number(global.source);
  if (rateLimit(source, 'request', 500)) {
    notifyError(source, result(() => inventory.sync(source)));
  }
});

onNet('varde_inventory:server:move', (fromSlot, toSlot, amount) => {
  const source = Number(global.source);
  if (rateLimit(source, 'move', 250)) {
    notifyError(
      source,
      result(() =>
        inventory.moveSlot(
          source,
          fromSlot,
          toSlot,
          amount,
          `source:${source}`,
        ),
      ),
    );
  }
});

onNet('varde_inventory:server:use', (slot) => {
  const source = Number(global.source);
  if (rateLimit(source, 'use', 750)) {
    notifyError(source, result(() => inventory.useItem(source, slot)));
  }
});

globalThis.exports('GetInventory', (identifier) => {
  try {
    return inventory.getInventory(identifier);
  } catch {
    return null;
  }
});
globalThis.exports('GetItemCount', (identifier, itemName, metadata) =>
  inventory.getItemCount(identifier, itemName, metadata),
);
globalThis.exports('HasItem', (identifier, itemName, amount, metadata) =>
  inventory.getItemCount(identifier, itemName, metadata) >= Number(amount || 1),
);
globalThis.exports('CanCarryItem', (identifier, itemName, amount, metadata) =>
  inventory.canCarryItem(identifier, itemName, amount, metadata),
);
globalThis.exports(
  'AddItem',
  (identifier, itemName, amount, metadata, targetSlot) =>
    result(() =>
      inventory.addItem(
        identifier,
        itemName,
        amount,
        metadata,
        invokingResource(),
        targetSlot,
      ),
    ),
);
globalThis.exports('RemoveItem', (identifier, itemName, amount, metadata) =>
  result(() =>
    inventory.removeItem(
      identifier,
      itemName,
      amount,
      metadata,
      invokingResource(),
    ),
  ),
);
globalThis.exports(
  'MoveItem',
  (identifier, fromSlot, toSlot, amount) =>
    result(() =>
      inventory.moveSlot(
        identifier,
        fromSlot,
        toSlot,
        amount,
        invokingResource(),
      ),
    ),
);
globalThis.exports(
  'TransferItem',
  (fromIdentifier, toIdentifier, fromSlot, amount, targetSlot) =>
    result(() =>
      inventory.transfer(
        fromIdentifier,
        toIdentifier,
        fromSlot,
        amount,
        targetSlot,
        invokingResource(),
      ),
    ),
);
globalThis.exports('RegisterStash', (stashId, label, slots, maxWeight) =>
  result(() => inventory.registerStash(stashId, label, slots, maxWeight)),
);
globalThis.exports('RegisterUsableItem', (itemName, handler) =>
  result(() => inventory.registerUsableItem(itemName, handler)),
);

setTimeout(() => {
  for (const player of core.getPlayers()) {
    const numericSource = Number(player.source);
    if (core.getPlayerData(numericSource)) {
      notifyError(numericSource, result(() => inventory.sync(numericSource)));
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
  `started with ${Object.keys(config.items).length} configured items`,
);
