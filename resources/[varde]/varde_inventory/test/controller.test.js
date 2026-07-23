'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryController } = require('../server/controller');

test('controller resolves only opaque player and secondary sides', () => {
  const calls = [];
  const inventory = {
    resolveOnline() {
      return {
        source: 7,
        characterId: 'vrd_0123456789abcdef',
        containerId: 'player:vrd_0123456789abcdef',
      };
    },
    getInventory(containerId) {
      return {
        id: containerId,
        type: containerId.startsWith('player:') ? 'player' : 'stash',
        label: 'Inventory',
        slots: 10,
        weight: 0,
        maxWeight: 1000,
        items: [],
      };
    },
    moveSlot(...args) {
      calls.push(['move', ...args]);
    },
    transfer(...args) {
      calls.push(['transfer', ...args]);
    },
    cleanupEmptyDrop() {
      return false;
    },
  };
  const controller = new InventoryController(inventory);
  const opened = controller.open(7, 'stash:evidence');
  assert.equal(opened.contract, 'varde.inventory.bootstrap.v1');
  assert.equal(opened.capabilities.transfer, true);

  controller.handle(7, 'move', {
    from: 'player',
    to: 'secondary',
    fromSlot: 1,
    toSlot: 2,
    amount: 1,
  });
  assert.equal(calls[0][0], 'transfer');
  assert.equal(calls[0][1], 'player:vrd_0123456789abcdef');
  assert.equal(calls[0][2], 'stash:evidence');
  assert.throws(
    () => controller.handle(7, 'move', { from: 'stash:evidence' }),
    { code: 'SIDE_INVALID' },
  );
});
