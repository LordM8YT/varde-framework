'use strict';

class VehiclesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VehiclesError';
    this.code = code;
  }
}

function vehiclesError(code, message) {
  return new VehiclesError(code, message);
}

module.exports = {
  VehiclesError,
  vehiclesError,
};
