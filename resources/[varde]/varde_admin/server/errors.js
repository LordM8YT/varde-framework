'use strict';

class AdminError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
  }
}

function adminError(code, message) {
  return new AdminError(code, message);
}

module.exports = {
  AdminError,
  adminError,
};
