'use strict';

const { inventoryError } = require('./errors');

const SIDES = new Set(['player', 'secondary']);

class InventoryController {
  constructor(inventory, options = {}) {
    this.inventory = inventory;
    this.hotbarSlots = Number(options.hotbarSlots || 5);
    this.sessions = new Map();
  }

  session(source) {
    const online = this.inventory.resolveOnline(source);
    const existing = this.sessions.get(online.source);
    if (existing?.player === online.containerId) {
      return existing;
    }
    const created = {
      source: online.source,
      player: online.containerId,
      secondary: null,
    };
    this.sessions.set(online.source, created);
    return created;
  }

  resolveSide(session, value) {
    const side = String(value || '');
    if (!SIDES.has(side)) {
      throw inventoryError('SIDE_INVALID', 'inventory side is invalid');
    }
    const containerId = session[side];
    if (!containerId) {
      throw inventoryError('SIDE_UNAVAILABLE', `${side} inventory is not open`);
    }
    return containerId;
  }

  payload(source) {
    const session = this.session(source);
    return {
      contract: 'varde.inventory.bootstrap.v1',
      player: this.inventory.getInventory(session.player),
      secondary: session.secondary
        ? this.inventory.getInventory(session.secondary)
        : null,
      hotbar: Array.from({ length: this.hotbarSlots }, (_, index) => index + 1),
      capabilities: {
        move: true,
        split: true,
        use: true,
        drop: true,
        transfer: session.secondary !== null,
      },
    };
  }

  open(source, secondaryContainerId = null) {
    const session = this.session(source);
    if (secondaryContainerId) {
      const inventory = this.inventory.getInventory(secondaryContainerId);
      if (inventory.id === session.player) {
        throw inventoryError(
          'VALIDATION_ERROR',
          'secondary inventory must differ from player inventory',
        );
      }
      session.secondary = inventory.id;
    } else {
      session.secondary = null;
    }
    return this.payload(source);
  }

  openDrop(source, dropId, position) {
    this.inventory.requireDropAccess(dropId, position);
    return this.open(source, dropId);
  }

  close(source) {
    this.sessions.delete(Number(source));
    return true;
  }

  verifySecondary(session, position) {
    if (session.secondary?.startsWith('drop:')) {
      this.inventory.requireDropAccess(session.secondary, position);
    }
  }

  handle(source, method, request = {}, position = null) {
    const action = String(method || '').trim();
    if (action === 'bootstrap') {
      return this.open(source);
    }
    if (action === 'close') {
      return this.close(source);
    }

    const session = this.session(source);
    this.verifySecondary(session, position);
    const actor = `source:${session.source}`;

    if (action === 'move') {
      const from = this.resolveSide(session, request.from);
      const to = this.resolveSide(session, request.to ?? request.from);
      if (from === to) {
        this.inventory.moveSlot(
          from,
          request.fromSlot,
          request.toSlot,
          request.amount,
          actor,
        );
      } else {
        this.inventory.transfer(
          from,
          to,
          request.fromSlot,
          request.amount,
          request.toSlot,
          actor,
        );
        if (this.inventory.cleanupEmptyDrop(from)) {
          session.secondary = null;
        }
      }
      return this.payload(source);
    }

    if (action === 'split') {
      const containerId = this.resolveSide(session, request.side);
      this.inventory.splitSlot(
        containerId,
        request.fromSlot,
        request.toSlot,
        request.amount,
        actor,
      );
      return this.payload(source);
    }

    if (action === 'use') {
      if (String(request.side || 'player') !== 'player') {
        throw inventoryError('SIDE_INVALID', 'only player items can be used');
      }
      this.inventory.useItem(source, request.slot);
      return this.payload(source);
    }

    if (action === 'drop') {
      if (String(request.side || 'player') !== 'player') {
        throw inventoryError('SIDE_INVALID', 'only player items can be dropped');
      }
      this.inventory.createDrop(
        source,
        request.slot,
        request.amount,
        position,
        actor,
      );
      return this.payload(source);
    }

    if (action === 'transfer') {
      const from = this.resolveSide(session, request.from);
      const to = this.resolveSide(session, request.to);
      if (from === to) {
        throw inventoryError(
          'VALIDATION_ERROR',
          'transfer inventories must differ',
        );
      }
      this.inventory.transfer(
        from,
        to,
        request.fromSlot,
        request.amount,
        request.toSlot,
        actor,
      );
      if (this.inventory.cleanupEmptyDrop(from)) {
        session.secondary = null;
      }
      return this.payload(source);
    }

    throw inventoryError('METHOD_NOT_FOUND', 'inventory method is unsupported');
  }
}

module.exports = {
  InventoryController,
};
