'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { inventoryError } = require('./errors');

function nowIso() {
  return new Date().toISOString();
}

function hydrateContainer(row) {
  return row
    ? {
        id: row.id,
        type: row.type,
        ownerId: row.owner_id,
        label: row.label,
        slots: Number(row.slots),
        maxWeight: Number(row.max_weight),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;
}

function hydrateItem(row) {
  if (!row) {
    return null;
  }
  let metadata = {};
  try {
    metadata = JSON.parse(row.metadata_json);
  } catch {
    metadata = {};
  }
  return {
    id: Number(row.id),
    containerId: row.container_id,
    slot: Number(row.slot),
    name: row.item_name,
    amount: Number(row.amount),
    metadata,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class InventoryDatabase {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.inTransaction = false;
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
    this.migrate();
    this.prepare();
  }

  migrate() {
    const version = Number(
      this.database.prepare('PRAGMA user_version').get().user_version,
    );
    if (version > 1) {
      throw inventoryError(
        'DATABASE_NEWER',
        `database schema ${version} is newer than this resource supports`,
      );
    }
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE inventory_containers (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          label TEXT NOT NULL,
          slots INTEGER NOT NULL CHECK (slots BETWEEN 1 AND 500),
          max_weight INTEGER NOT NULL CHECK (max_weight BETWEEN 0 AND 2000000000),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE inventory_items (
          id INTEGER PRIMARY KEY,
          container_id TEXT NOT NULL
            REFERENCES inventory_containers(id) ON DELETE CASCADE,
          slot INTEGER NOT NULL CHECK (slot > 0),
          item_name TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0),
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (container_id, slot)
        ) STRICT;

        CREATE INDEX inventory_items_name_idx
          ON inventory_items(container_id, item_name);

        CREATE TABLE inventory_audit (
          id INTEGER PRIMARY KEY,
          action TEXT NOT NULL,
          from_container TEXT,
          to_container TEXT,
          item_name TEXT NOT NULL,
          amount INTEGER NOT NULL,
          metadata_json TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX inventory_audit_container_idx
          ON inventory_audit(from_container, to_container, id DESC);

        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  prepare() {
    this.statements = {
      createContainer: this.database.prepare(`
        INSERT INTO inventory_containers (
          id, type, owner_id, label, slots, max_weight, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `),
      getContainer: this.database.prepare(`
        SELECT * FROM inventory_containers WHERE id = ?
      `),
      listItems: this.database.prepare(`
        SELECT * FROM inventory_items
        WHERE container_id = ?
        ORDER BY slot ASC
      `),
      getItem: this.database.prepare(`
        SELECT * FROM inventory_items
        WHERE container_id = ? AND slot = ?
      `),
      insertItem: this.database.prepare(`
        INSERT INTO inventory_items (
          container_id, slot, item_name, amount, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      updateAmount: this.database.prepare(`
        UPDATE inventory_items SET amount = ?, updated_at = ? WHERE id = ?
      `),
      updateSlot: this.database.prepare(`
        UPDATE inventory_items SET slot = ?, updated_at = ? WHERE id = ?
      `),
      deleteItem: this.database.prepare(`
        DELETE FROM inventory_items WHERE id = ?
      `),
      deleteContainer: this.database.prepare(`
        DELETE FROM inventory_containers WHERE id = ?
      `),
      audit: this.database.prepare(`
        INSERT INTO inventory_audit (
          action,
          from_container,
          to_container,
          item_name,
          amount,
          metadata_json,
          actor,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      listAudit: this.database.prepare(`
        SELECT action, from_container, to_container, item_name, amount,
          metadata_json, actor, created_at
        FROM inventory_audit
        WHERE from_container = ? OR to_container = ?
        ORDER BY id ASC
      `),
    };
  }

  transaction(work) {
    if (this.inTransaction) {
      throw inventoryError(
        'DATABASE_TRANSACTION',
        'nested transactions are unsupported',
      );
    }
    this.inTransaction = true;
    let began = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      began = true;
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (began) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  ensureContainer(id, type, ownerId, label, slots, maxWeight) {
    const timestamp = nowIso();
    this.statements.createContainer.run(
      id,
      type,
      ownerId,
      label,
      slots,
      maxWeight,
      timestamp,
      timestamp,
    );
    return this.getContainer(id);
  }

  getContainer(id) {
    return hydrateContainer(this.statements.getContainer.get(id));
  }

  listItems(containerId) {
    return this.statements.listItems.all(containerId).map(hydrateItem);
  }

  getItem(containerId, slot) {
    return hydrateItem(this.statements.getItem.get(containerId, slot));
  }

  insertItem(containerId, slot, itemName, amount, metadataJson) {
    const timestamp = nowIso();
    const result = this.statements.insertItem.run(
      containerId,
      slot,
      itemName,
      amount,
      metadataJson,
      timestamp,
      timestamp,
    );
    return Number(result.lastInsertRowid);
  }

  updateAmount(itemId, amount) {
    this.statements.updateAmount.run(amount, nowIso(), itemId);
  }

  updateSlot(itemId, slot) {
    this.statements.updateSlot.run(slot, nowIso(), itemId);
  }

  deleteItem(itemId) {
    this.statements.deleteItem.run(itemId);
  }

  deleteContainer(containerId) {
    return Number(this.statements.deleteContainer.run(containerId).changes) === 1;
  }

  audit(action, fromContainer, toContainer, itemName, amount, metadata, actor) {
    this.statements.audit.run(
      action,
      fromContainer || null,
      toContainer || null,
      itemName,
      amount,
      JSON.stringify(metadata || {}),
      String(actor || 'system').slice(0, 96),
      nowIso(),
    );
  }

  listAudit(containerId) {
    return this.statements.listAudit
      .all(containerId, containerId)
      .map((row) => ({
        action: row.action,
        fromContainer: row.from_container,
        toContainer: row.to_container,
        itemName: row.item_name,
        amount: Number(row.amount),
        metadata: JSON.parse(row.metadata_json),
        actor: row.actor,
        createdAt: row.created_at,
      }));
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  InventoryDatabase,
};
