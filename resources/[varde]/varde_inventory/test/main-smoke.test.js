'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('Cfx wiring boots and exposes safe inventory operations', () => {
  const resourceRoot = path.resolve(__dirname, '..');
  const mainPath = path.join(resourceRoot, 'server', 'main.js');
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'varde-inventory-main-'),
  );
  const eventHandlers = new Map();
  const netHandlers = new Map();
  const registeredExports = new Map();
  const emitted = [];
  const player = { characterId: 'vrd_0123456789abcdef' };

  function registerExport(name, handler) {
    registeredExports.set(name, handler);
  }
  registerExport.varde_core = {
    GetPlayerData(identifier) {
      return Number(identifier) === 7 || identifier === player.characterId
        ? player
        : null;
    },
    GetPlayers() {
      return [];
    },
    GetPlayerSource(characterId) {
      return characterId === player.characterId ? 7 : 0;
    },
  };

  const context = {
    require: createRequire(mainPath),
    console,
    GetCurrentResourceName() {
      return 'varde_inventory';
    },
    GetResourcePath() {
      return temporaryRoot;
    },
    LoadResourceFile(_resource, relativePath) {
      return fs.readFileSync(path.join(resourceRoot, relativePath), 'utf8');
    },
    GetInvokingResource() {
      return 'smoke_test';
    },
    GetPlayers() {
      return [];
    },
    emitNet(eventName, source, ...args) {
      emitted.push({ eventName, source, args });
    },
    on(eventName, handler) {
      eventHandlers.set(eventName, handler);
    },
    onNet(eventName, handler) {
      netHandlers.set(eventName, handler);
    },
    exports: registerExport,
    setTimeout(handler) {
      handler();
      return 1;
    },
  };
  context.global = context;
  vm.createContext(context);

  try {
    vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context, {
      filename: mainPath,
    });

    assert.equal(eventHandlers.has('varde:server:playerLoaded'), true);
    assert.equal(eventHandlers.has('varde:server:characterDeleted'), true);
    assert.equal(netHandlers.has('varde_inventory:server:move'), true);
    assert.equal(registeredExports.has('AddItem'), true);

    eventHandlers.get('varde:server:playerLoaded')(7, player);
    const added = registeredExports.get('AddItem')(7, 'water', 2, {
      quality: 100,
    });
    assert.equal(added.ok, true);
    assert.equal(registeredExports.get('GetItemCount')(7, 'water'), 2);

    context.source = 7;
    netHandlers.get('varde_inventory:server:move')(1, 2, 1);
    assert.equal(
      emitted.some(
        (event) => event.eventName === 'varde_inventory:client:update',
      ),
      true,
    );

    eventHandlers.get('onResourceStop')('varde_inventory');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
