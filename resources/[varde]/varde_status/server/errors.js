'use strict';

class StatusError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StatusError';
    this.code = code;
  }
}

function statusError(code, message) {
  return new StatusError(code, message);
}

module.exports = {
  StatusError,
  statusError,
};
