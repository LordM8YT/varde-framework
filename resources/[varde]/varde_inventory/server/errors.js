'use strict';

class InventoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
  }
}

function inventoryError(code, message) {
  return new InventoryError(code, message);
}

module.exports = {
  InventoryError,
  inventoryError,
};
