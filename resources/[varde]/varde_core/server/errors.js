'use strict';

class FrameworkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FrameworkError';
    this.code = code;
  }
}

function frameworkError(code, message) {
  return new FrameworkError(code, message);
}

module.exports = {
  FrameworkError,
  frameworkError,
};
