'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('Cfx wiring boots and protects the admin request channel', () => {
  const resourceRoot = path.resolve(__dirname, '..');
  const mainPath = path.join(resourceRoot, 'server', 'main.js');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-admin-main-'));
  const eventHandlers = new Map();
  const netHandlers = new Map();
  const registeredExports = new Map();
  const emitted = [];
  const players = new Map([
    [
      7,
      {
        characterId: 'vrd_0123456789abcdef',
        profile: { firstName: 'Ada', lastName: 'Admin' },
        job: { name: 'unemployed', label: 'Unemployed', grade: 0 },
      },
    ],
  ]);

  function registerExport(name, handler) {
    registeredExports.set(name, handler);
  }
  registerExport.varde_core = {
    GetPlayerData(identifier) {
      return players.get(Number(identifier)) || null;
    },
    GetPlayers() {
      return [...players.entries()].map(([source, player]) => ({
        source,
        ...player,
      }));
    },
    SetMoney() {
      return { ok: true, data: 0 };
    },
  };
  registerExport.varde_jobs = {
    AssignJob() {
      return { ok: true, data: true };
    },
  };
  registerExport.varde_inventory = {
    AddItem() {
      return { ok: true, data: true };
    },
  };

  const context = {
    require: createRequire(mainPath),
    Buffer,
    console,
    GetCurrentResourceName() {
      return 'varde_admin';
    },
    GetResourcePath() {
      return temporaryRoot;
    },
    LoadResourceFile(_resource, relativePath) {
      return fs.readFileSync(path.join(resourceRoot, relativePath), 'utf8');
    },
    IsPlayerAceAllowed() {
      return true;
    },
    GetPlayerName() {
      return 'Admin';
    },
    GetPlayerPing() {
      return 25;
    },
    GetPlayerPed() {
      return 1;
    },
    GetEntityCoords() {
      return [1, 2, 3];
    },
    GetResourceState() {
      return 'started';
    },
    DropPlayer() {},
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
    assert.equal(netHandlers.has('varde_admin:server:request'), true);
    assert.equal(registeredExports.has('HasPermission'), true);

    context.source = 7;
    netHandlers.get('varde_admin:server:request')('smoke:1', 'bootstrap', {});
    const response = emitted.at(-1);
    assert.equal(response.eventName, 'varde_admin:client:response');
    assert.equal(
      response.args[1].ok,
      true,
      JSON.stringify(response.args[1]),
    );
    assert.equal(response.args[1].data.players.length, 1);

    assert.doesNotThrow(() =>
      eventHandlers.get('onResourceStop')('varde_admin'),
    );
  } finally {
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});
