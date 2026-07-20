'use strict';

const path = require('node:path');
const { phoneError } = require('./errors');

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw phoneError(
      'CONFIG_INVALID',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function validateConfig(input, resourcePath = process.cwd()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw phoneError('CONFIG_INVALID', 'phone config must be an object');
  }
  const numberPrefix = String(input.numberPrefix ?? '5');
  const numberLength = integer(input.numberLength ?? 8, 6, 15, 'numberLength');
  if (
    !/^\d{1,6}$/.test(numberPrefix) ||
    numberPrefix.length >= numberLength
  ) {
    throw phoneError('CONFIG_INVALID', 'numberPrefix is invalid');
  }
  const phoneItem = String(input.phoneItem || 'phone').trim();
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(phoneItem)) {
    throw phoneError('CONFIG_INVALID', 'phoneItem is invalid');
  }
  return {
    databaseFile: path.resolve(
      resourcePath,
      String(input.databaseFile || 'data/phone.sqlite'),
    ),
    numberPrefix,
    numberLength,
    requirePhoneItem: input.requirePhoneItem === true,
    phoneItem,
    messageMaxLength: integer(
      input.messageMaxLength ?? 500,
      1,
      2000,
      'messageMaxLength',
    ),
    conversationPageSize: integer(
      input.conversationPageSize ?? 50,
      10,
      100,
      'conversationPageSize',
    ),
  };
}

function loadConfig(runtime) {
  const raw = runtime.loadResourceFile('config/phone.json');
  if (!raw) {
    throw phoneError('CONFIG_MISSING', 'config/phone.json could not be loaded');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw phoneError('CONFIG_INVALID', 'config/phone.json is not valid JSON');
  }
  return validateConfig(parsed, runtime.resourcePath);
}

module.exports = {
  loadConfig,
  validateConfig,
};
