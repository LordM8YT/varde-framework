'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('Cfx wiring boots and serves the phone request channel', () => {
  const resourceRoot = path.resolve(__dirname, '..');
  const mainPath = path.join(resourceRoot, 'server', 'main.js');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-phone-main-'));
  const eventHandlers = new Map();
  const netHandlers = new Map();
  const registeredExports = new Map();
  const emitted = [];
  const player = {
    characterId: 'vrd_0123456789abcdef',
    profile: { firstName: 'Phone', lastName: 'Test' },
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
    GetPlayerSource(characterId) {
      return characterId === player.characterId ? 7 : 0;
    },
  };
  registerExport.varde_inventory = {
    HasItem() {
      return true;
    },
  };

  const context = {
    require: createRequire(mainPath),
    Buffer,
    console,
    GetCurrentResourceName() {
      return 'varde_phone';
    },
    GetResourcePath() {
      return temporaryRoot;
    },
    LoadResourceFile(_resource, relativePath) {
      return fs.readFileSync(path.join(resourceRoot, relativePath), 'utf8');
    },
    GetResourceState() {
      return 'started';
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
  };
  context.global = context;
  vm.createContext(context);

  try {
    vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context, {
      filename: mainPath,
    });
    assert.equal(netHandlers.has('varde_phone:server:request'), true);
    assert.equal(eventHandlers.has('varde:server:characterDeleted'), true);
    assert.equal(registeredExports.has('GetPhoneNumber'), true);

    context.source = 7;
    netHandlers.get('varde_phone:server:request')(
      'smoke:1',
      'bootstrap',
      {},
    );
    const response = emitted.at(-1);
    assert.equal(response.eventName, 'varde_phone:client:response');
    assert.equal(response.args[1].ok, true);
    assert.match(response.args[1].data.account.phoneNumber, /^5\d{7}$/);

    eventHandlers.get('onResourceStop')('varde_phone');
  } finally {
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});
