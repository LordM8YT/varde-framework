'use strict';

const { randomUUID } = require('node:crypto');
const { inventoryError } = require('./errors');

const CHARACTER_ID_PATTERN = /^vrd_[a-f0-9]{16}$/;
const ITEM_NAME_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;
const CONTAINER_ID_PATTERN =
  /^(player|stash|drop|vehicle):[A-Za-z0-9_.:-]{1,96}$/;
const STASH_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const CONTAINER_TYPE_PATTERN = /^(stash|vehicle)$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw inventoryError(
      'VALIDATION_ERROR',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function canonicalize(value, depth = 0) {
  if (depth > 6) {
    throw inventoryError('METADATA_INVALID', 'metadata is nested too deeply');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw inventoryError('METADATA_INVALID', 'metadata numbers must be finite');
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw inventoryError('METADATA_INVALID', 'metadata arrays are too large');
    }
    return value.map((entry) => canonicalize(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result = {};
    const keys = Object.keys(value).sort();
    if (keys.length > 100) {
      throw inventoryError('METADATA_INVALID', 'metadata has too many keys');
    }
    for (const key of keys) {
      if (key.length > 64 || key === '__proto__' || key === 'constructor') {
        throw inventoryError('METADATA_INVALID', 'metadata contains an invalid key');
      }
      result[key] = canonicalize(value[key], depth + 1);
    }
    return result;
  }
  throw inventoryError('METADATA_INVALID', 'metadata contains an unsupported value');
}

function normalizeMetadata(value) {
  const metadata = canonicalize(value ?? {});
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
    throw inventoryError('METADATA_INVALID', 'metadata must be an object');
  }
  const json = JSON.stringify(metadata);
  if (Buffer.byteLength(json, 'utf8') > 2048) {
    throw inventoryError('METADATA_INVALID', 'metadata exceeds 2048 bytes');
  }
  return { metadata, json };
}

function normalizePosition(value) {
  const position = {
    x: Number(value?.x ?? value?.[0]),
    y: Number(value?.y ?? value?.[1]),
    z: Number(value?.z ?? value?.[2]),
  };
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z) ||
    Math.abs(position.x) > 20_000 ||
    Math.abs(position.y) > 20_000 ||
    Math.abs(position.z) > 5_000
  ) {
    throw inventoryError('POSITION_INVALID', 'world position is invalid');
  }
  return position;
}

class InventoryService {
  constructor(database, config, core, runtime) {
    this.database = database;
    this.config = config;
    this.core = core;
    this.runtime = runtime;
    this.usableItems = new Map();
  }

  itemDefinition(value) {
    const name = String(value || '').trim().toLowerCase();
    if (!ITEM_NAME_PATTERN.test(name)) {
      throw inventoryError('VALIDATION_ERROR', 'item name is invalid');
    }
    const definition = this.config.items[name];
    if (!definition) {
      throw inventoryError('ITEM_NOT_FOUND', `item ${name} is not configured`);
    }
    return { name, definition };
  }

  resolveContainer(identifier) {
    if (
      typeof identifier === 'string' &&
      CONTAINER_ID_PATTERN.test(identifier)
    ) {
      return identifier;
    }
    if (
      typeof identifier === 'string' &&
      CHARACTER_ID_PATTERN.test(identifier)
    ) {
      return `player:${identifier}`;
    }
    const player = this.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw inventoryError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    return `player:${player.characterId}`;
  }

  resolveOnline(identifier) {
    const player = this.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw inventoryError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    const source =
      typeof identifier === 'number' || /^\d+$/.test(String(identifier))
        ? Number(identifier)
        : Number(this.core.getPlayerSource(player.characterId));
    if (!Number.isSafeInteger(source) || source <= 0) {
      throw inventoryError('PLAYER_NOT_FOUND', 'online player source was not found');
    }
    return {
      source,
      characterId: player.characterId,
      containerId: `player:${player.characterId}`,
    };
  }

  requireContainer(containerId) {
    let container = this.database.getContainer(containerId);
    if (!container && containerId.startsWith('player:')) {
      const characterId = containerId.slice('player:'.length);
      if (!CHARACTER_ID_PATTERN.test(characterId)) {
        throw inventoryError('CONTAINER_INVALID', 'player container is invalid');
      }
      container = this.database.ensureContainer(
        containerId,
        'player',
        characterId,
        'Player inventory',
        this.config.playerSlots,
        this.config.playerMaxWeight,
      );
    }
    if (!container) {
      throw inventoryError('CONTAINER_NOT_FOUND', 'inventory container was not found');
    }
    return container;
  }

  registerStash(stashId, label, slots, maxWeight) {
    const id = String(stashId || '').trim();
    const validLabel = String(label || '').trim();
    if (!STASH_ID_PATTERN.test(id)) {
      throw inventoryError('VALIDATION_ERROR', 'stash id is invalid');
    }
    if (!validLabel || validLabel.length > 64) {
      throw inventoryError('VALIDATION_ERROR', 'stash label is invalid');
    }
    const containerId = `stash:${id}`;
    return this.database.ensureContainer(
      containerId,
      'stash',
      id,
      validLabel,
      integer(slots, 1, 500, 'slots'),
      integer(maxWeight, 0, 2_000_000_000, 'maxWeight'),
    );
  }

  registerContainer(containerId, type, ownerId, label, slots, maxWeight) {
    const id = String(containerId || '').trim();
    const validType = String(type || '').trim().toLowerCase();
    const owner = String(ownerId || '').trim();
    const validLabel = String(label || '').trim();
    if (
      !CONTAINER_ID_PATTERN.test(id) ||
      !CONTAINER_TYPE_PATTERN.test(validType) ||
      !id.startsWith(`${validType}:`)
    ) {
      throw inventoryError('VALIDATION_ERROR', 'container id or type is invalid');
    }
    if (!owner || owner.length > 96) {
      throw inventoryError('VALIDATION_ERROR', 'container owner is invalid');
    }
    if (!validLabel || validLabel.length > 64) {
      throw inventoryError('VALIDATION_ERROR', 'container label is invalid');
    }
    return this.database.ensureContainer(
      id,
      validType,
      owner,
      validLabel,
      integer(slots, 1, 500, 'slots'),
      integer(maxWeight, 0, 2_000_000_000, 'maxWeight'),
    );
  }

  deleteContainer(identifier) {
    const containerId = this.resolveContainer(identifier);
    const container = this.requireContainer(containerId);
    if (container.type === 'player') {
      throw inventoryError(
        'CONTAINER_PROTECTED',
        'player containers are deleted through character cleanup',
      );
    }
    if (container.type === 'drop') {
      return this.removeDrop(container.id);
    }
    return this.database.deleteContainer(container.id);
  }

  decorateItem(item) {
    const definition = this.config.items[item.name];
    return {
      slot: item.slot,
      name: item.name,
      label: definition?.label || item.name,
      amount: item.amount,
      weight: definition?.weight || 0,
      totalWeight: (definition?.weight || 0) * item.amount,
      stackable: definition?.stackable === true,
      maxStack: definition?.maxStack || 1,
      metadata: clone(item.metadata),
    };
  }

  weight(items) {
    return items.reduce((total, item) => {
      const definition = this.config.items[item.name];
      return total + (definition?.weight || 0) * item.amount;
    }, 0);
  }

  getInventory(identifier) {
    const containerId = this.resolveContainer(identifier);
    const container = this.requireContainer(containerId);
    const rawItems = this.database.listItems(containerId);
    return {
      id: container.id,
      type: container.type,
      label: container.label,
      slots: container.slots,
      maxWeight: container.maxWeight,
      weight: this.weight(rawItems),
      items: rawItems.map((item) => this.decorateItem(item)),
    };
  }

  syncContainer(containerId) {
    if (!containerId.startsWith('player:')) {
      return;
    }
    const characterId = containerId.slice('player:'.length);
    const source = Number(this.core.getPlayerSource(characterId));
    if (Number.isSafeInteger(source) && source > 0) {
      this.runtime.emitClient(
        source,
        'varde_inventory:client:update',
        this.getInventory(containerId),
      );
    }
  }

  sync(identifier) {
    const online = this.resolveOnline(identifier);
    const inventory = this.getInventory(online.containerId);
    this.runtime.emitClient(
      online.source,
      'varde_inventory:client:update',
      inventory,
    );
    return inventory;
  }

  planAdd(container, itemName, definition, amount, metadataJson, targetSlot) {
    const items = this.database.listItems(container.id);
    const newWeight = this.weight(items) + definition.weight * amount;
    if (!Number.isSafeInteger(newWeight) || newWeight > container.maxWeight) {
      throw inventoryError('WEIGHT_LIMIT', 'inventory weight limit would be exceeded');
    }

    if (targetSlot !== undefined && targetSlot !== null) {
      const slot = integer(targetSlot, 1, container.slots, 'targetSlot');
      const target = items.find((item) => item.slot === slot);
      const capacity = target
        ? target.name === itemName &&
          target.metadataJson === metadataJson &&
          definition.stackable
          ? definition.maxStack - target.amount
          : 0
        : definition.maxStack;
      if (capacity < amount) {
        throw inventoryError(
          target ? 'TARGET_OCCUPIED' : 'STACK_LIMIT',
          'the target slot cannot hold that amount',
        );
      }
      return { items, targetSlot: slot };
    }

    let capacity = 0;
    if (definition.stackable) {
      for (const item of items) {
        if (item.name === itemName && item.metadataJson === metadataJson) {
          capacity += Math.max(0, definition.maxStack - item.amount);
        }
      }
    }
    capacity += (container.slots - items.length) * definition.maxStack;
    if (capacity < amount) {
      throw inventoryError('SLOT_LIMIT', 'inventory does not have enough free slots');
    }
    return { items, targetSlot: null };
  }

  applyAdd(
    container,
    itemName,
    definition,
    amount,
    metadataJson,
    plan,
  ) {
    let remaining = amount;
    if (plan.targetSlot !== null) {
      const target = plan.items.find((item) => item.slot === plan.targetSlot);
      if (target) {
        this.database.updateAmount(target.id, target.amount + remaining);
      } else {
        this.database.insertItem(
          container.id,
          plan.targetSlot,
          itemName,
          remaining,
          metadataJson,
        );
      }
      return;
    }

    if (definition.stackable) {
      for (const item of plan.items) {
        if (
          remaining > 0 &&
          item.name === itemName &&
          item.metadataJson === metadataJson &&
          item.amount < definition.maxStack
        ) {
          const moved = Math.min(remaining, definition.maxStack - item.amount);
          this.database.updateAmount(item.id, item.amount + moved);
          remaining -= moved;
        }
      }
    }

    const occupied = new Set(plan.items.map((item) => item.slot));
    for (let slot = 1; slot <= container.slots && remaining > 0; slot += 1) {
      if (!occupied.has(slot)) {
        const stack = Math.min(remaining, definition.maxStack);
        this.database.insertItem(
          container.id,
          slot,
          itemName,
          stack,
          metadataJson,
        );
        remaining -= stack;
      }
    }
    if (remaining !== 0) {
      throw inventoryError('SLOT_LIMIT', 'inventory add plan became invalid');
    }
  }

  addItem(
    identifier,
    itemName,
    amount = 1,
    metadata = {},
    actor = 'resource',
    targetSlot,
  ) {
    const containerId = this.resolveContainer(identifier);
    const container = this.requireContainer(containerId);
    const item = this.itemDefinition(itemName);
    const validAmount = integer(amount, 1, 1_000_000, 'amount');
    const normalized = normalizeMetadata(metadata);
    const plan = this.planAdd(
      container,
      item.name,
      item.definition,
      validAmount,
      normalized.json,
      targetSlot,
    );

    this.database.transaction(() => {
      this.applyAdd(
        container,
        item.name,
        item.definition,
        validAmount,
        normalized.json,
        plan,
      );
      this.database.audit(
        'added',
        null,
        container.id,
        item.name,
        validAmount,
        normalized.metadata,
        actor,
      );
    });
    this.syncContainer(container.id);
    return this.getInventory(container.id);
  }

  matchingItems(containerId, itemName, metadata) {
    const item = this.itemDefinition(itemName);
    const metadataJson =
      metadata === undefined ? null : normalizeMetadata(metadata).json;
    return {
      item,
      matches: this.database
        .listItems(containerId)
        .filter(
          (entry) =>
            entry.name === item.name &&
            (metadataJson === null || entry.metadataJson === metadataJson),
        ),
    };
  }

  applyRemoval(matches, amount) {
    let remaining = amount;
    for (const entry of matches) {
      if (remaining <= 0) {
        break;
      }
      const removed = Math.min(entry.amount, remaining);
      if (removed === entry.amount) {
        this.database.deleteItem(entry.id);
      } else {
        this.database.updateAmount(entry.id, entry.amount - removed);
      }
      remaining -= removed;
    }
    if (remaining !== 0) {
      throw inventoryError('ITEM_AMOUNT_MISSING', 'inventory amount changed');
    }
  }

  removeItem(
    identifier,
    itemName,
    amount = 1,
    metadata,
    actor = 'resource',
  ) {
    const containerId = this.resolveContainer(identifier);
    this.requireContainer(containerId);
    const validAmount = integer(amount, 1, 1_000_000, 'amount');
    const { item, matches } = this.matchingItems(
      containerId,
      itemName,
      metadata,
    );
    const available = matches.reduce((total, entry) => total + entry.amount, 0);
    if (available < validAmount) {
      throw inventoryError('ITEM_AMOUNT_MISSING', `not enough ${item.name}`);
    }

    this.database.transaction(() => {
      this.applyRemoval(matches, validAmount);
      this.database.audit(
        'removed',
        containerId,
        null,
        item.name,
        validAmount,
        metadata ?? {},
        actor,
      );
    });
    this.syncContainer(containerId);
    return this.getInventory(containerId);
  }

  getItemCount(identifier, itemName, metadata) {
    try {
      const containerId = this.resolveContainer(identifier);
      this.requireContainer(containerId);
      const { matches } = this.matchingItems(containerId, itemName, metadata);
      return matches.reduce((total, entry) => total + entry.amount, 0);
    } catch {
      return 0;
    }
  }

  canCarryItem(identifier, itemName, amount = 1, metadata = {}) {
    try {
      const containerId = this.resolveContainer(identifier);
      const container = this.requireContainer(containerId);
      const item = this.itemDefinition(itemName);
      const validAmount = integer(amount, 1, 1_000_000, 'amount');
      const normalized = normalizeMetadata(metadata);
      this.planAdd(
        container,
        item.name,
        item.definition,
        validAmount,
        normalized.json,
      );
      return true;
    } catch {
      return false;
    }
  }

  moveSlot(identifier, fromSlot, toSlot, amount, actor = 'player') {
    const containerId = this.resolveContainer(identifier);
    const container = this.requireContainer(containerId);
    const sourceSlot = integer(fromSlot, 1, container.slots, 'fromSlot');
    const targetSlot = integer(toSlot, 1, container.slots, 'toSlot');
    if (sourceSlot === targetSlot) {
      return this.getInventory(containerId);
    }
    const source = this.database.getItem(containerId, sourceSlot);
    if (!source) {
      throw inventoryError('ITEM_NOT_FOUND', 'source slot is empty');
    }
    const moveAmount = integer(
      amount ?? source.amount,
      1,
      source.amount,
      'amount',
    );
    const target = this.database.getItem(containerId, targetSlot);
    const definition = this.itemDefinition(source.name).definition;

    this.database.transaction(() => {
      if (!target) {
        if (moveAmount === source.amount) {
          this.database.updateSlot(source.id, targetSlot);
        } else {
          this.database.updateAmount(source.id, source.amount - moveAmount);
          this.database.insertItem(
            containerId,
            targetSlot,
            source.name,
            moveAmount,
            source.metadataJson,
          );
        }
      } else if (
        target.name === source.name &&
        target.metadataJson === source.metadataJson &&
        definition.stackable
      ) {
        if (target.amount + moveAmount > definition.maxStack) {
          throw inventoryError('STACK_LIMIT', 'target stack would be too large');
        }
        this.database.updateAmount(target.id, target.amount + moveAmount);
        if (moveAmount === source.amount) {
          this.database.deleteItem(source.id);
        } else {
          this.database.updateAmount(source.id, source.amount - moveAmount);
        }
      } else {
        if (moveAmount !== source.amount) {
          throw inventoryError(
            'TARGET_OCCUPIED',
            'partial stacks cannot swap with another item',
          );
        }
        const temporarySlot = container.slots + 1;
        this.database.updateSlot(source.id, temporarySlot);
        this.database.updateSlot(target.id, sourceSlot);
        this.database.updateSlot(source.id, targetSlot);
      }
      this.database.audit(
        'moved',
        containerId,
        containerId,
        source.name,
        moveAmount,
        source.metadata,
        actor,
      );
    });
    this.syncContainer(containerId);
    return this.getInventory(containerId);
  }

  splitSlot(identifier, fromSlot, toSlot, amount, actor = 'player') {
    const containerId = this.resolveContainer(identifier);
    const container = this.requireContainer(containerId);
    const sourceSlot = integer(fromSlot, 1, container.slots, 'fromSlot');
    const targetSlot = integer(toSlot, 1, container.slots, 'toSlot');
    if (sourceSlot === targetSlot) {
      throw inventoryError('VALIDATION_ERROR', 'split slots must be different');
    }
    const source = this.database.getItem(container.id, sourceSlot);
    if (!source) {
      throw inventoryError('ITEM_NOT_FOUND', 'source slot is empty');
    }
    const definition = this.itemDefinition(source.name).definition;
    if (!definition.stackable || source.amount < 2) {
      throw inventoryError('ITEM_NOT_SPLITTABLE', 'item stack cannot be split');
    }
    const splitAmount = integer(amount, 1, source.amount - 1, 'amount');
    if (this.database.getItem(container.id, targetSlot)) {
      throw inventoryError('TARGET_OCCUPIED', 'split target slot must be empty');
    }

    this.database.transaction(() => {
      this.database.updateAmount(source.id, source.amount - splitAmount);
      this.database.insertItem(
        container.id,
        targetSlot,
        source.name,
        splitAmount,
        source.metadataJson,
      );
      this.database.audit(
        'split',
        container.id,
        container.id,
        source.name,
        splitAmount,
        source.metadata,
        actor,
      );
    });
    this.syncContainer(container.id);
    return this.getInventory(container.id);
  }

  transfer(
    fromIdentifier,
    toIdentifier,
    fromSlot,
    amount,
    targetSlot,
    actor = 'resource',
  ) {
    const fromId = this.resolveContainer(fromIdentifier);
    const toId = this.resolveContainer(toIdentifier);
    if (fromId === toId) {
      if (targetSlot === undefined || targetSlot === null) {
        throw inventoryError(
          'VALIDATION_ERROR',
          'targetSlot is required within one inventory',
        );
      }
      return this.moveSlot(fromId, fromSlot, targetSlot, amount, actor);
    }

    const from = this.requireContainer(fromId);
    const to = this.requireContainer(toId);
    const sourceSlot = integer(fromSlot, 1, from.slots, 'fromSlot');
    const source = this.database.getItem(from.id, sourceSlot);
    if (!source) {
      throw inventoryError('ITEM_NOT_FOUND', 'source slot is empty');
    }
    const moveAmount = integer(
      amount ?? source.amount,
      1,
      source.amount,
      'amount',
    );
    const definition = this.itemDefinition(source.name).definition;
    const plan = this.planAdd(
      to,
      source.name,
      definition,
      moveAmount,
      source.metadataJson,
      targetSlot,
    );

    this.database.transaction(() => {
      this.applyRemoval([source], moveAmount);
      this.applyAdd(
        to,
        source.name,
        definition,
        moveAmount,
        source.metadataJson,
        plan,
      );
      this.database.audit(
        'transferred',
        from.id,
        to.id,
        source.name,
        moveAmount,
        source.metadata,
        actor,
      );
    });
    this.syncContainer(from.id);
    this.syncContainer(to.id);
    return {
      from: this.getInventory(from.id),
      to: this.getInventory(to.id),
    };
  }

  createDrop(identifier, slot, amount, position, actor = 'player') {
    const online = this.resolveOnline(identifier);
    const validPosition = normalizePosition(position);
    const dropId = `drop:${randomUUID()}`;
    const expiresAt = new Date(Date.now() + this.config.dropLifetimeMs).toISOString();

    this.database.ensureContainer(
      dropId,
      'drop',
      online.characterId,
      'Ground',
      this.config.dropSlots,
      this.config.dropMaxWeight,
    );
    this.database.createDrop(dropId, validPosition, expiresAt);

    try {
      const transfer = this.transfer(
        online.containerId,
        dropId,
        slot,
        amount,
        1,
        actor,
      );
      const drop = this.database.getDrop(dropId);
      this.runtime.emitAll?.('varde_inventory:client:dropCreated', drop);
      return { drop, inventory: transfer.from };
    } catch (error) {
      this.database.deleteContainer(dropId);
      throw error;
    }
  }

  getDrops() {
    return this.database.listDrops();
  }

  requireDropAccess(containerId, position) {
    const id = String(containerId || '').trim();
    if (!id.startsWith('drop:')) {
      throw inventoryError('DROP_INVALID', 'drop id is invalid');
    }
    const drop = this.database.getDrop(id);
    if (!drop) {
      throw inventoryError('DROP_NOT_FOUND', 'drop no longer exists');
    }
    if (Date.parse(drop.expiresAt) <= Date.now()) {
      this.removeDrop(id);
      throw inventoryError('DROP_EXPIRED', 'drop has expired');
    }
    const current = normalizePosition(position);
    const dx = current.x - drop.position.x;
    const dy = current.y - drop.position.y;
    const dz = current.z - drop.position.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > this.config.dropOpenDistance) {
      throw inventoryError('DROP_TOO_FAR', 'player is too far from the drop');
    }
    return drop;
  }

  removeDrop(containerId) {
    const drop = this.database.getDrop(containerId);
    if (!drop) {
      return false;
    }
    const deleted = this.database.deleteContainer(containerId);
    if (deleted) {
      this.runtime.emitAll?.('varde_inventory:client:dropRemoved', containerId);
    }
    return deleted;
  }

  cleanupEmptyDrop(containerId) {
    if (
      String(containerId || '').startsWith('drop:') &&
      this.database.listItems(containerId).length === 0
    ) {
      return this.removeDrop(containerId);
    }
    return false;
  }

  cleanupExpiredDrops(now = Date.now()) {
    let removed = 0;
    for (const drop of this.database.listDrops()) {
      if (Date.parse(drop.expiresAt) <= now && this.removeDrop(drop.id)) {
        removed += 1;
      }
    }
    return removed;
  }

  registerUsableItem(itemName, handler) {
    const item = this.itemDefinition(itemName);
    if (typeof handler !== 'function') {
      throw inventoryError('VALIDATION_ERROR', 'usable item handler is invalid');
    }
    this.usableItems.set(item.name, handler);
    return true;
  }

  useItem(identifier, slot) {
    const online = this.resolveOnline(identifier);
    const inventory = this.requireContainer(online.containerId);
    const validSlot = integer(slot, 1, inventory.slots, 'slot');
    const item = this.database.getItem(inventory.id, validSlot);
    if (!item) {
      throw inventoryError('ITEM_NOT_FOUND', 'item slot is empty');
    }
    const handler = this.usableItems.get(item.name);
    if (!handler) {
      throw inventoryError('ITEM_NOT_USABLE', `${item.name} is not usable`);
    }
    const outcome = handler(online.source, this.decorateItem(item));
    if (outcome && typeof outcome.then === 'function') {
      throw inventoryError(
        'HANDLER_ASYNC_UNSUPPORTED',
        'usable item handlers must complete synchronously',
      );
    }
    if (outcome === false) {
      throw inventoryError('USE_REJECTED', 'item use was rejected');
    }
    const consume =
      outcome === true
        ? 1
        : integer(outcome?.consume ?? 0, 0, item.amount, 'consume');
    if (consume > 0) {
      this.database.transaction(() => {
        this.applyRemoval([item], consume);
        this.database.audit(
          'used',
          inventory.id,
          null,
          item.name,
          consume,
          item.metadata,
          `source:${online.source}`,
        );
      });
    }
    this.syncContainer(inventory.id);
    return this.getInventory(inventory.id);
  }

  deleteCharacter(characterId) {
    if (!CHARACTER_ID_PATTERN.test(String(characterId))) {
      return false;
    }
    return this.database.deleteContainer(`player:${characterId}`);
  }
}

module.exports = {
  InventoryService,
  normalizeMetadata,
  normalizePosition,
};
