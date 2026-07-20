'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { frameworkError } = require('./errors');

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function makePublicId() {
  return `vrd_${crypto.randomBytes(8).toString('hex')}`;
}

class FrameworkDatabase {
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
      throw frameworkError(
        'DATABASE_NEWER',
        `database schema ${version} is newer than this core supports`,
      );
    }

    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE accounts (
          id INTEGER PRIMARY KEY,
          primary_identifier TEXT NOT NULL UNIQUE,
          identifiers_json TEXT NOT NULL,
          display_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE characters (
          id INTEGER PRIMARY KEY,
          account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          public_id TEXT NOT NULL UNIQUE,
          slot INTEGER NOT NULL CHECK (slot > 0),
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          birth_date TEXT NOT NULL,
          gender TEXT NOT NULL,
          nationality TEXT NOT NULL,
          job_json TEXT NOT NULL,
          position_json TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (account_id, slot)
        ) STRICT;

        CREATE INDEX characters_account_idx ON characters(account_id);

        CREATE TABLE wallets (
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          currency TEXT NOT NULL,
          balance INTEGER NOT NULL CHECK (balance >= 0),
          PRIMARY KEY (character_id, currency)
        ) STRICT;

        CREATE TABLE money_ledger (
          id INTEGER PRIMARY KEY,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          currency TEXT NOT NULL,
          delta INTEGER NOT NULL,
          balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
          reason TEXT NOT NULL,
          reference TEXT,
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX money_ledger_character_idx
          ON money_ledger(character_id, created_at DESC);

        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  prepare() {
    this.statements = {
      upsertAccount: this.database.prepare(`
        INSERT INTO accounts (
          primary_identifier,
          identifiers_json,
          display_name,
          created_at,
          last_seen_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(primary_identifier) DO UPDATE SET
          identifiers_json = excluded.identifiers_json,
          display_name = excluded.display_name,
          last_seen_at = excluded.last_seen_at
      `),
      getAccount: this.database.prepare(`
        SELECT * FROM accounts WHERE primary_identifier = ?
      `),
      getCharacterBySlot: this.database.prepare(`
        SELECT id FROM characters WHERE account_id = ? AND slot = ?
      `),
      insertCharacter: this.database.prepare(`
        INSERT INTO characters (
          account_id,
          public_id,
          slot,
          first_name,
          last_name,
          birth_date,
          gender,
          nationality,
          job_json,
          position_json,
          metadata_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      listCharacters: this.database.prepare(`
        SELECT * FROM characters WHERE account_id = ? ORDER BY slot ASC
      `),
      getOwnedCharacter: this.database.prepare(`
        SELECT * FROM characters WHERE account_id = ? AND public_id = ?
      `),
      getCharacterByPublicId: this.database.prepare(`
        SELECT * FROM characters WHERE public_id = ?
      `),
      listWallets: this.database.prepare(`
        SELECT currency, balance FROM wallets WHERE character_id = ?
      `),
      insertWallet: this.database.prepare(`
        INSERT INTO wallets (character_id, currency, balance) VALUES (?, ?, ?)
      `),
      getWallet: this.database.prepare(`
        SELECT balance FROM wallets WHERE character_id = ? AND currency = ?
      `),
      updateWallet: this.database.prepare(`
        UPDATE wallets SET balance = ? WHERE character_id = ? AND currency = ?
      `),
      insertLedger: this.database.prepare(`
        INSERT INTO money_ledger (
          character_id,
          currency,
          delta,
          balance_after,
          reason,
          reference,
          actor,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      saveCharacter: this.database.prepare(`
        UPDATE characters SET
          job_json = ?,
          position_json = ?,
          metadata_json = ?,
          updated_at = ?
        WHERE id = ?
      `),
      ledgerEntries: this.database.prepare(`
        SELECT currency, delta, balance_after, reason, reference, actor, created_at
        FROM money_ledger
        WHERE character_id = ?
        ORDER BY id ASC
      `),
    };
  }

  transaction(work) {
    if (this.inTransaction) {
      throw frameworkError('DATABASE_TRANSACTION', 'nested transactions are not supported');
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

  upsertAccount(primaryIdentifier, identifiers, displayName) {
    const timestamp = nowIso();
    this.statements.upsertAccount.run(
      primaryIdentifier,
      JSON.stringify(identifiers),
      String(displayName || 'unknown').slice(0, 96),
      timestamp,
      timestamp,
    );
    return this.statements.getAccount.get(primaryIdentifier);
  }

  listCharacters(accountId) {
    return this.statements.listCharacters
      .all(accountId)
      .map((row) => this.hydrateCharacter(row));
  }

  createCharacter(accountId, profile, defaults) {
    if (this.statements.getCharacterBySlot.get(accountId, profile.slot)) {
      throw frameworkError('SLOT_TAKEN', `character slot ${profile.slot} is already in use`);
    }

    const timestamp = nowIso();
    const publicId = makePublicId();

    return this.transaction(() => {
      const result = this.statements.insertCharacter.run(
        accountId,
        publicId,
        profile.slot,
        profile.firstName,
        profile.lastName,
        profile.birthDate,
        profile.gender,
        profile.nationality,
        JSON.stringify(defaults.defaultJob),
        JSON.stringify(defaults.defaultSpawn),
        '{}',
        timestamp,
        timestamp,
      );
      const characterId = Number(result.lastInsertRowid);

      for (const [currency, balance] of Object.entries(defaults.startingMoney)) {
        this.statements.insertWallet.run(characterId, currency, balance);
        if (balance > 0) {
          this.statements.insertLedger.run(
            characterId,
            currency,
            balance,
            balance,
            'character_created',
            publicId,
            'system',
            timestamp,
          );
        }
      }

      const row = this.statements.getOwnedCharacter.get(accountId, publicId);
      return this.hydrateCharacter(row);
    });
  }

  loadOwnedCharacter(accountId, publicId) {
    const row = this.statements.getOwnedCharacter.get(accountId, publicId);
    return row ? this.hydrateCharacter(row) : null;
  }

  loadCharacter(publicId) {
    const row = this.statements.getCharacterByPublicId.get(publicId);
    return row ? this.hydrateCharacter(row) : null;
  }

  hydrateCharacter(row) {
    const money = Object.create(null);
    for (const wallet of this.statements.listWallets.all(row.id)) {
      money[wallet.currency] = Number(wallet.balance);
    }

    return {
      internalId: Number(row.id),
      accountId: Number(row.account_id),
      characterId: row.public_id,
      slot: Number(row.slot),
      profile: {
        firstName: row.first_name,
        lastName: row.last_name,
        birthDate: row.birth_date,
        gender: row.gender,
        nationality: row.nationality,
      },
      job: parseJson(row.job_json, {}),
      position: parseJson(row.position_json, {}),
      metadata: parseJson(row.metadata_json, {}),
      money,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  saveCharacter(character) {
    const timestamp = nowIso();
    const result = this.statements.saveCharacter.run(
      JSON.stringify(character.job),
      JSON.stringify(character.position),
      JSON.stringify(character.metadata),
      timestamp,
      character.internalId,
    );
    if (Number(result.changes) !== 1) {
      throw frameworkError('CHARACTER_NOT_FOUND', 'character could not be saved');
    }
    character.updatedAt = timestamp;
  }

  changeMoney(character, currency, delta, reason, reference, actor) {
    return this.transaction(() => {
      const wallet = this.statements.getWallet.get(character.internalId, currency);
      if (!wallet) {
        throw frameworkError('CURRENCY_NOT_FOUND', `wallet ${currency} does not exist`);
      }

      const currentBalance = Number(wallet.balance);
      const balance = currentBalance + delta;
      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw frameworkError('INSUFFICIENT_FUNDS', `insufficient ${currency}`);
      }

      this.statements.updateWallet.run(balance, character.internalId, currency);
      this.statements.insertLedger.run(
        character.internalId,
        currency,
        delta,
        balance,
        reason,
        reference || null,
        actor,
        nowIso(),
      );
      return balance;
    });
  }

  setMoney(character, currency, amount, reason, reference, actor) {
    return this.transaction(() => {
      const wallet = this.statements.getWallet.get(character.internalId, currency);
      if (!wallet) {
        throw frameworkError('CURRENCY_NOT_FOUND', `wallet ${currency} does not exist`);
      }

      const currentBalance = Number(wallet.balance);
      const delta = amount - currentBalance;
      this.statements.updateWallet.run(amount, character.internalId, currency);
      this.statements.insertLedger.run(
        character.internalId,
        currency,
        delta,
        amount,
        reason,
        reference || null,
        actor,
        nowIso(),
      );
      return amount;
    });
  }

  getLedger(characterId) {
    const character = this.statements.getCharacterByPublicId.get(characterId);
    if (!character) {
      return [];
    }
    return this.statements.ledgerEntries.all(character.id);
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  FrameworkDatabase,
  makePublicId,
};
