'use strict';

class PhoneError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhoneError';
    this.code = code;
  }
}

function phoneError(code, message) {
  return new PhoneError(code, message);
}

module.exports = {
  PhoneError,
  phoneError,
};
