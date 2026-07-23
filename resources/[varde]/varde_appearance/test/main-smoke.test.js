'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('Cfx wiring boots and exposes appearance APIs', () => {
  const resourceRoot = path.resolve(__dirname, '..');
  const mainPath = path.join(resourceRoot, 'server', 'main.js');
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'varde-appearance-main-'),
  );
  const eventHandlers = new Map();
  const netHandlers = new Map();
  const registeredExports = new Map();
  const emitted = [];
  const player = {
    characterId: 'vrd_0123456789abcdef',
    profile: { gender: 'male' },
  };

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
      return 'varde_appearance';
    },
    GetResourcePath() {
      return temporaryRoot;
    },
    LoadResourceFile(_resource, relativePath) {
      return fs.readFileSync(path.join(resourceRoot, relativePath), 'utf8');
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
    assert.equal(netHandlers.has('varde_appearance:server:save'), true);
    assert.equal(registeredExports.has('GetAppearance'), true);
    assert.equal(registeredExports.has('SaveAppearance'), true);

    eventHandlers.get('varde:server:playerLoaded')(7, player);
    const current = registeredExports.get('GetAppearance')(7);
    assert.equal(current.model, 'mp_m_freemode_01');
    assert.equal(
      emitted.some(
        (entry) => entry.eventName === 'varde_appearance:client:update',
      ),
      true,
    );
    eventHandlers.get('onResourceStop')('varde_appearance');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
