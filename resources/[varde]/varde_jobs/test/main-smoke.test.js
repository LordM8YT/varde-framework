'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('Cfx wiring boots and serves job events, commands, and exports', () => {
  const resourceRoot = path.resolve(__dirname, '..');
  const mainPath = path.join(resourceRoot, 'server', 'main.js');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-jobs-main-'));
  const eventHandlers = new Map();
  const netHandlers = new Map();
  const commands = new Map();
  const registeredExports = new Map();
  const emitted = [];
  const player = { characterId: 'vrd_0123456789abcdef' };
  let currentJob = null;

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
    SetJob(_identifier, job) {
      currentJob = job;
      return { ok: true, data: job };
    },
  };

  const context = {
    require: createRequire(mainPath),
    console,
    GetCurrentResourceName() {
      return 'varde_jobs';
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
    IsPlayerAceAllowed() {
      return true;
    },
    GetPlayerPed() {
      return 1;
    },
    GetEntityCoords() {
      return [441.13, -981.94, 30.69];
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
    RegisterCommand(name, handler) {
      commands.set(name, handler);
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
    const code = fs.readFileSync(mainPath, 'utf8');
    vm.runInContext(code, context, { filename: mainPath });

    assert.equal(eventHandlers.has('varde:server:playerLoaded'), true);
    assert.equal(netHandlers.has('varde_jobs:server:clock'), true);
    assert.equal(commands.has('assignjob'), true);
    assert.equal(registeredExports.has('HasPermission'), true);

    eventHandlers.get('varde:server:playerLoaded')(7, player);
    assert.equal(currentJob.name, 'unemployed');
    assert.equal(
      emitted.some((event) => event.eventName === 'varde_jobs:client:update'),
      true,
    );

    commands.get('assignjob')(0, ['7', 'police', '1']);
    const assignResult = registeredExports.get('HasJob')(7, 'police', 1);
    assert.equal(assignResult, true);

    context.source = 7;
    netHandlers.get('varde_jobs:server:setActive')('police');
    netHandlers.get('varde_jobs:server:clock')('police');
    assert.equal(
      registeredExports.get('HasPermission')(7, 'police.evidence'),
      true,
    );

    eventHandlers.get('onResourceStop')('varde_jobs');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
