'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppearanceDatabase } = require('../server/database');
const {
  AppearanceService,
  normalizeAppearance,
} = require('../server/service');
const { validateConfig } = require('../server/config');

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-appearance-'));
  const database = new AppearanceDatabase(path.join(directory, 'appearance.sqlite'));
  const players = new Map([
    [
      7,
      {
        characterId: 'vrd_0123456789abcdef',
        profile: { gender: 'female' },
      },
    ],
  ]);
  const events = [];
  const core = {
    getPlayerData(identifier) {
      if (identifier === 'vrd_0123456789abcdef') {
        return players.get(7);
      }
      return players.get(Number(identifier)) || null;
    },
    getPlayerSource(characterId) {
      return characterId === 'vrd_0123456789abcdef' ? 7 : 0;
    },
  };
  const config = validateConfig(
    {
      databaseFile: 'appearance.sqlite',
      allowedModels: ['mp_m_freemode_01', 'mp_f_freemode_01'],
      genderModels: {
        male: 'mp_m_freemode_01',
        female: 'mp_f_freemode_01',
        unspecified: 'mp_m_freemode_01',
      },
    },
    directory,
  );
  const service = new AppearanceService(database, config, core, {
    emitClient(source, eventName, payload) {
      events.push({ source, eventName, payload });
    },
  });
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { config, database, service, events };
}

test('appearance validation strips unknown fields and bounds native values', (t) => {
  const { config } = harness(t);
  const appearance = normalizeAppearance(
    {
      model: 'mp_f_freemode_01',
      components: [
        { componentId: 3, drawable: 2, texture: 1, palette: 0, ignored: true },
      ],
      props: [{ propId: 0, drawable: -1, texture: 0 }],
      faceFeatures: [{ index: 0, value: 0.5 }],
      headOverlays: [{ overlayId: 1, value: 2, opacity: 0.8 }],
      unknown: 'removed',
    },
    config,
  );
  assert.equal(appearance.unknown, undefined);
  assert.equal(appearance.components[0].drawable, 2);
  assert.throws(
    () =>
      normalizeAppearance(
        {
          model: 'not_allowed',
        },
        config,
      ),
    { code: 'MODEL_NOT_ALLOWED' },
  );
});

test('gender default, save, reset, sync, and cleanup persist', (t) => {
  const { service, database, events } = harness(t);
  const initial = service.get(7);
  assert.equal(initial.model, 'mp_f_freemode_01');

  const saved = service.save(7, {
    ...initial,
    hairColor: 4,
    components: [{ componentId: 2, drawable: 3, texture: 0, palette: 0 }],
  });
  assert.equal(saved.hairColor, 4);
  service.sync(7);
  assert.equal(events.at(-1).eventName, 'varde_appearance:client:update');

  const reset = service.reset(7);
  assert.equal(reset.model, 'mp_f_freemode_01');
  assert.equal(reset.hairColor, 0);
  assert.equal(service.deleteCharacter('vrd_0123456789abcdef'), true);
  assert.equal(database.get('vrd_0123456789abcdef'), null);
});
