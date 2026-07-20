'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('Cfx wiring boots and completes connection, creation, and selection', () => {
  const resourceRoot = path.resolve(__dirname, '..');
  const mainPath = path.join(resourceRoot, 'server', 'main.js');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-main-'));
  const eventHandlers = new Map();
  const netHandlers = new Map();
  const registeredExports = new Map();
  const emitted = [];
  const states = [];
  const localEvents = [];
  const logs = [];
  let timerId = 0;

  const context = {
    require: createRequire(mainPath),
    console: {
      log(message) {
        logs.push(message);
      },
      warn(message) {
        logs.push(message);
      },
      error(message) {
        logs.push(message);
      },
    },
    GetCurrentResourceName() {
      return 'varde_core';
    },
    GetResourcePath() {
      return temporaryRoot;
    },
    LoadResourceFile(_resource, relativePath) {
      return fs.readFileSync(path.join(resourceRoot, relativePath), 'utf8');
    },
    GetConvarInt(_name, fallback) {
      return fallback;
    },
    GetNumPlayerIdentifiers() {
      return 2;
    },
    GetPlayerIdentifier(_source, index) {
      return index === 0 ? 'license2:smoke' : 'fivem:42';
    },
    GetPlayerName() {
      return 'Smoke Player';
    },
    GetInvokingResource() {
      return 'smoke_test';
    },
    Player(source) {
      return {
        state: {
          set(key, value, replicated) {
            states.push({ source, key, value, replicated });
          },
        },
      };
    },
    emitNet(eventName, source, ...args) {
      emitted.push({ eventName, source, args });
    },
    emit(eventName, ...args) {
      localEvents.push({ eventName, args });
    },
    on(eventName, handler) {
      eventHandlers.set(eventName, handler);
    },
    onNet(eventName, handler) {
      netHandlers.set(eventName, handler);
    },
    exports(name, handler) {
      registeredExports.set(name, handler);
    },
    setTimeout(handler) {
      handler();
      return 1;
    },
    setInterval() {
      timerId += 1;
      return timerId;
    },
    clearInterval() {},
  };
  context.global = context;
  vm.createContext(context);

  try {
    const source = 42;
    context.source = source;
    const code = fs.readFileSync(mainPath, 'utf8');
    vm.runInContext(code, context, { filename: mainPath });

    assert.equal(netHandlers.has('varde:server:rpc'), true);
    assert.equal(eventHandlers.has('playerConnecting'), true);
    assert.equal(registeredExports.has('AddMoney'), true);

    let deferralResult = 'not-called';
    eventHandlers.get('playerConnecting')(
      'Smoke Player',
      () => {},
      {
        defer() {},
        update() {},
        done(reason) {
          deferralResult = reason;
        },
      },
    );
    assert.equal(deferralResult, undefined);

    const rpc = netHandlers.get('varde:server:rpc');
    rpc('smoke:create', 'characters:create', {
      slot: 1,
      firstName: 'Smoke',
      lastName: 'Tester',
      birthDate: '1990-01-01',
      gender: 'unspecified',
      nationality: 'Norwegian',
    });
    const createResponse = emitted.at(-1).args[1];
    assert.equal(createResponse.ok, true);
    const characterId = createResponse.data.characterId;

    rpc('smoke:select', 'characters:select', { characterId });
    const selectResponse = emitted.at(-1).args[1];
    assert.equal(selectResponse.ok, true);
    assert.equal(selectResponse.data.characterId, characterId);
    assert.equal(
      states.some((state) => state.key === 'varde:loaded' && state.value === true),
      true,
    );

    const addMoney = registeredExports.get('AddMoney');
    const moneyResult = addMoney(source, 'cash', 50, 'smoke_test', 'smoke:1');
    assert.equal(moneyResult.ok, true);
    assert.equal(moneyResult.data, 550);

    eventHandlers.get('onResourceStop')('varde_core');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
