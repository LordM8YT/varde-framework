'use strict';

class AppearanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppearanceError';
    this.code = code;
  }
}

function appearanceError(code, message) {
  return new AppearanceError(code, message);
}

module.exports = {
  AppearanceError,
  appearanceError,
};
