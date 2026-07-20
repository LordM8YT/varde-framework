'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JobsDatabase } = require('../server/database');
const { JobsService } = require('../server/service');
const { validateConfig } = require('../server/config');

function createHarness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-jobs-service-'));
  const database = new JobsDatabase(path.join(directory, 'jobs.sqlite'));
  const characterId = 'vrd_0123456789abcdef';
  const players = new Map([[7, { characterId }]]);
  const coreUpdates = [];
  const clientEvents = [];
  const core = {
    getPlayerData(identifier) {
      if (typeof identifier === 'string') {
        return [...players.values()].find(
          (player) => player.characterId === identifier,
        ) || null;
      }
      return players.get(Number(identifier)) || null;
    },
    getPlayerSource(id) {
      for (const [source, player] of players) {
        if (player.characterId === id) {
          return source;
        }
      }
      return 0;
    },
    setJob(source, job) {
      coreUpdates.push({ source, job });
      return { ok: true, data: job };
    },
  };
  const runtime = {
    emitClient(source, eventName, payload) {
      clientEvents.push({ source, eventName, payload });
    },
  };
  const config = validateConfig(
    {
      databaseFile: 'jobs.sqlite',
      defaultJob: 'unemployed',
      maxJobs: 2,
      permissionRequiresDuty: true,
      jobs: {
        unemployed: {
          label: 'Unemployed',
          type: 'civilian',
          grades: {
            0: { label: 'Citizen', payment: 0, permissions: [] },
          },
        },
        police: {
          label: 'Police',
          type: 'leo',
          grades: {
            0: {
              label: 'Cadet',
              payment: 500,
              permissions: ['police.records.read'],
            },
            1: {
              label: 'Officer',
              payment: 750,
              permissions: ['police.records.read', 'police.evidence'],
            },
          },
        },
      },
    },
    directory,
  );
  const service = new JobsService(database, config, core, runtime);

  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { service, database, coreUpdates, clientEvents, characterId };
}

test('sync creates and publishes the default job', (t) => {
  const { service, coreUpdates, clientEvents } = createHarness(t);
  const snapshot = service.sync(7);

  assert.equal(snapshot.activeJob.name, 'unemployed');
  assert.equal(coreUpdates.at(-1).job.type, 'civilian');
  assert.equal(clientEvents.at(-1).eventName, 'varde_jobs:client:update');
});

test('assignment, active job, duty, and permissions form one lifecycle', (t) => {
  const { service } = createHarness(t);
  service.sync(7);
  service.assign(7, 'police', 1, 'unit-test');
  service.setActive(7, 'police');

  assert.equal(service.hasJob(7, 'police', 1), true);
  assert.equal(service.hasPermission(7, 'police.evidence'), false);

  const snapshot = service.setDuty(7, true);
  assert.equal(snapshot.activeJob.onDuty, true);
  assert.equal(service.hasPermission(7, 'police.evidence'), true);

  const removed = service.remove(7, 'police', 'unit-test');
  assert.equal(removed.activeJob.name, 'unemployed');
  assert.equal(service.hasJob(7, 'police'), false);
});

test('unknown grades and the job limit are rejected', (t) => {
  const { service } = createHarness(t);
  service.sync(7);

  assert.throws(() => service.assign(7, 'police', 9), {
    code: 'GRADE_NOT_FOUND',
  });
  service.assign(7, 'police', 0);
  assert.throws(() => service.assign(7, 'missing', 0), {
    code: 'JOB_NOT_FOUND',
  });
});
