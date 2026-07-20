'use strict';

const { frameworkError } = require('./errors');

const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}' -]{1,31}$/u;
const SIMPLE_TEXT_PATTERN = /^[\p{L}\p{M}0-9 .'_-]{1,31}$/u;
const CURRENCY_PATTERN = /^[a-z][a-z0-9_]{1,23}$/;
const METADATA_KEY_PATTERN = /^[a-z][a-zA-Z0-9_.:-]{0,63}$/;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, field, pattern) {
  if (typeof value !== 'string') {
    throw frameworkError('VALIDATION_ERROR', `${field} must be a string`);
  }
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!pattern.test(cleaned)) {
    throw frameworkError('VALIDATION_ERROR', `${field} has an invalid format`);
  }
  return cleaned;
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateCharacterInput(value, maxCharacters) {
  if (!plainObject(value)) {
    throw frameworkError('VALIDATION_ERROR', 'character must be an object');
  }

  const slot = Number(value.slot);
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > maxCharacters) {
    throw frameworkError(
      'VALIDATION_ERROR',
      `slot must be between 1 and ${maxCharacters}`,
    );
  }

  const birthDate = String(value.birthDate || '');
  if (!validDateOnly(birthDate)) {
    throw frameworkError('VALIDATION_ERROR', 'birthDate must use YYYY-MM-DD');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (birthDate < '1900-01-01' || birthDate > today) {
    throw frameworkError(
      'VALIDATION_ERROR',
      'birthDate must be between 1900-01-01 and today',
    );
  }

  return {
    slot,
    firstName: cleanText(value.firstName, 'firstName', NAME_PATTERN),
    lastName: cleanText(value.lastName, 'lastName', NAME_PATTERN),
    birthDate,
    gender: cleanText(value.gender || 'unspecified', 'gender', SIMPLE_TEXT_PATTERN),
    nationality: cleanText(
      value.nationality || 'Unknown',
      'nationality',
      SIMPLE_TEXT_PATTERN,
    ),
  };
}

function validatePosition(value) {
  if (!plainObject(value)) {
    throw frameworkError('VALIDATION_ERROR', 'position must be an object');
  }

  const position = {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
    heading: Number(value.heading),
  };

  for (const [key, coordinate] of Object.entries(position)) {
    if (!Number.isFinite(coordinate)) {
      throw frameworkError('VALIDATION_ERROR', `position.${key} must be finite`);
    }
  }

  if (
    Math.abs(position.x) > 20_000 ||
    Math.abs(position.y) > 20_000 ||
    position.z < -2_000 ||
    position.z > 10_000
  ) {
    throw frameworkError('VALIDATION_ERROR', 'position is outside allowed world bounds');
  }

  position.heading = ((position.heading % 360) + 360) % 360;
  return position;
}

function validateCurrency(value) {
  if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) {
    throw frameworkError('VALIDATION_ERROR', 'currency is invalid');
  }
  return value;
}

function validateAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) {
    throw frameworkError(
      'VALIDATION_ERROR',
      'amount must be a positive integer no greater than 1000000000',
    );
  }
  return amount;
}

function validateReason(value) {
  if (value === undefined || value === null || value === '') {
    return 'unspecified';
  }
  if (typeof value !== 'string') {
    throw frameworkError('VALIDATION_ERROR', 'reason must be a string');
  }
  const reason = value.trim();
  if (!reason || reason.length > 128) {
    throw frameworkError('VALIDATION_ERROR', 'reason must contain 1-128 characters');
  }
  return reason;
}

function validateMetadata(key, value) {
  if (typeof key !== 'string' || !METADATA_KEY_PATTERN.test(key)) {
    throw frameworkError('VALIDATION_ERROR', 'metadata key is invalid');
  }
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw frameworkError('VALIDATION_ERROR', 'metadata key is reserved');
  }

  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw frameworkError('VALIDATION_ERROR', 'metadata value must be JSON serializable');
  }
  if (encoded === undefined || encoded.length > 16_384) {
    throw frameworkError('VALIDATION_ERROR', 'metadata value exceeds 16 KiB');
  }

  return JSON.parse(encoded);
}

module.exports = {
  plainObject,
  validateAmount,
  validateCharacterInput,
  validateCurrency,
  validateMetadata,
  validatePosition,
  validateReason,
};
