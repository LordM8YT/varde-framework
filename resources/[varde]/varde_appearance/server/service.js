'use strict';

const { appearanceError } = require('./errors');

const CHARACTER_ID_PATTERN = /^vrd_[a-f0-9]{16}$/;

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw appearanceError(
      'APPEARANCE_INVALID',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function number(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw appearanceError(
      'APPEARANCE_INVALID',
      `${label} must be between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function uniqueEntries(entries, idName, minimum, maximum, label, mapper) {
  if (entries === undefined) {
    return [];
  }
  if (!Array.isArray(entries) || entries.length > maximum - minimum + 1) {
    throw appearanceError('APPEARANCE_INVALID', `${label} must be an array`);
  }
  const seen = new Set();
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw appearanceError(
        'APPEARANCE_INVALID',
        `${label}[${index}] must be an object`,
      );
    }
    const id = integer(entry[idName], minimum, maximum, `${label}.${idName}`);
    if (seen.has(id)) {
      throw appearanceError(
        'APPEARANCE_INVALID',
        `${label} contains duplicate ${idName}`,
      );
    }
    seen.add(id);
    return mapper(entry, id);
  });
}

function normalizeAppearance(input, config) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw appearanceError('APPEARANCE_INVALID', 'appearance must be an object');
  }
  const model = String(input.model || '').trim().toLowerCase();
  if (!config.allowedModelSet.has(model)) {
    throw appearanceError('MODEL_NOT_ALLOWED', 'ped model is not allowed');
  }

  const components = uniqueEntries(
    input.components,
    'componentId',
    0,
    11,
    'components',
    (entry, componentId) => ({
      componentId,
      drawable: integer(entry.drawable ?? 0, 0, 1024, 'component.drawable'),
      texture: integer(entry.texture ?? 0, 0, 256, 'component.texture'),
      palette: integer(entry.palette ?? 0, 0, 3, 'component.palette'),
    }),
  );
  const props = uniqueEntries(
    input.props,
    'propId',
    0,
    7,
    'props',
    (entry, propId) => ({
      propId,
      drawable: integer(entry.drawable ?? -1, -1, 1024, 'prop.drawable'),
      texture: integer(entry.texture ?? 0, 0, 256, 'prop.texture'),
    }),
  );
  const faceFeatures = uniqueEntries(
    input.faceFeatures,
    'index',
    0,
    19,
    'faceFeatures',
    (entry, index) => ({
      index,
      value: number(entry.value ?? 0, -1, 1, 'faceFeature.value'),
    }),
  );
  const headOverlays = uniqueEntries(
    input.headOverlays,
    'overlayId',
    0,
    12,
    'headOverlays',
    (entry, overlayId) => ({
      overlayId,
      value: integer(entry.value ?? 255, 0, 255, 'headOverlay.value'),
      opacity: number(entry.opacity ?? 1, 0, 1, 'headOverlay.opacity'),
      colorType: integer(
        entry.colorType ?? 0,
        0,
        2,
        'headOverlay.colorType',
      ),
      color: integer(entry.color ?? 0, 0, 63, 'headOverlay.color'),
      secondaryColor: integer(
        entry.secondaryColor ?? 0,
        0,
        63,
        'headOverlay.secondaryColor',
      ),
    }),
  );

  let headBlend = null;
  if (input.headBlend !== undefined && input.headBlend !== null) {
    const value = input.headBlend;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw appearanceError(
        'APPEARANCE_INVALID',
        'headBlend must be an object',
      );
    }
    headBlend = {
      shapeFirst: integer(value.shapeFirst ?? 0, 0, 45, 'headBlend.shapeFirst'),
      shapeSecond: integer(
        value.shapeSecond ?? 0,
        0,
        45,
        'headBlend.shapeSecond',
      ),
      shapeThird: integer(value.shapeThird ?? 0, 0, 45, 'headBlend.shapeThird'),
      skinFirst: integer(value.skinFirst ?? 0, 0, 45, 'headBlend.skinFirst'),
      skinSecond: integer(value.skinSecond ?? 0, 0, 45, 'headBlend.skinSecond'),
      skinThird: integer(value.skinThird ?? 0, 0, 45, 'headBlend.skinThird'),
      shapeMix: number(value.shapeMix ?? 0.5, 0, 1, 'headBlend.shapeMix'),
      skinMix: number(value.skinMix ?? 0.5, 0, 1, 'headBlend.skinMix'),
      thirdMix: number(value.thirdMix ?? 0, 0, 1, 'headBlend.thirdMix'),
    };
  }

  const appearance = {
    version: 1,
    model,
    components,
    props,
    headBlend,
    faceFeatures,
    headOverlays,
    hairColor: integer(input.hairColor ?? 0, 0, 63, 'hairColor'),
    hairHighlight: integer(
      input.hairHighlight ?? 0,
      0,
      63,
      'hairHighlight',
    ),
    eyeColor: integer(input.eyeColor ?? 0, 0, 31, 'eyeColor'),
  };
  if (Buffer.byteLength(JSON.stringify(appearance), 'utf8') > 32_768) {
    throw appearanceError(
      'APPEARANCE_INVALID',
      'appearance exceeds 32768 bytes',
    );
  }
  return appearance;
}

class AppearanceService {
  constructor(database, config, core, runtime) {
    this.database = database;
    this.config = config;
    this.core = core;
    this.runtime = runtime;
  }

  resolveCharacter(identifier) {
    if (
      typeof identifier === 'string' &&
      CHARACTER_ID_PATTERN.test(identifier)
    ) {
      return identifier;
    }
    const player = this.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw appearanceError('PLAYER_NOT_FOUND', 'player or character was not found');
    }
    return player.characterId;
  }

  resolveOnline(identifier) {
    const characterId = this.resolveCharacter(identifier);
    const source =
      typeof identifier === 'number' || /^\d+$/.test(String(identifier))
        ? Number(identifier)
        : Number(this.core.getPlayerSource(characterId));
    if (!Number.isSafeInteger(source) || source <= 0) {
      throw appearanceError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    return { source, characterId };
  }

  defaultAppearance(identifier) {
    const player = this.core.getPlayerData(identifier);
    const rawGender = String(player?.profile?.gender || 'unspecified')
      .trim()
      .toLowerCase();
    const gender = Object.hasOwn(this.config.genderModels, rawGender)
      ? rawGender
      : 'unspecified';
    return normalizeAppearance(
      {
        model: this.config.genderModels[gender],
        components: [],
        props: [],
        faceFeatures: [],
        headOverlays: [],
      },
      this.config,
    );
  }

  get(identifier) {
    const characterId = this.resolveCharacter(identifier);
    const stored = this.database.get(characterId);
    if (stored) {
      return stored.appearance;
    }
    return this.database.save(
      characterId,
      this.defaultAppearance(identifier),
    ).appearance;
  }

  save(identifier, appearance) {
    const characterId = this.resolveCharacter(identifier);
    return this.database.save(
      characterId,
      normalizeAppearance(appearance, this.config),
    ).appearance;
  }

  reset(identifier) {
    const characterId = this.resolveCharacter(identifier);
    return this.database.save(
      characterId,
      this.defaultAppearance(identifier),
    ).appearance;
  }

  sync(identifier) {
    const online = this.resolveOnline(identifier);
    const appearance = this.get(online.characterId);
    this.runtime.emitClient(
      online.source,
      'varde_appearance:client:update',
      appearance,
    );
    return appearance;
  }

  deleteCharacter(characterId) {
    if (!CHARACTER_ID_PATTERN.test(String(characterId))) {
      return false;
    }
    return this.database.delete(characterId);
  }
}

module.exports = {
  AppearanceService,
  normalizeAppearance,
};
