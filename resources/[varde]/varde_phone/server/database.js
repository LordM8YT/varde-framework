'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { phoneError } = require('./errors');

function nowIso() {
  return new Date().toISOString();
}

function hydrateAccount(row) {
  return row
    ? {
        characterId: row.character_id,
        phoneNumber: row.phone_number,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;
}

function hydrateContact(row) {
  return row
    ? {
        id: Number(row.id),
        characterId: row.owner_character_id,
        phoneNumber: row.contact_number,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;
}

function hydrateMessage(row) {
  return row
    ? {
        id: Number(row.id),
        senderNumber: row.sender_number,
        recipientNumber: row.recipient_number,
        body: row.body,
        clientNonce: row.client_nonce,
        sentAt: row.sent_at,
        readAt: row.read_at,
      }
    : null;
}

class PhoneDatabase {
  constructor(filename, numberPrefix, numberLength) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.numberPrefix = numberPrefix;
    this.numberLength = numberLength;
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
      throw phoneError(
        'DATABASE_NEWER',
        `database schema ${version} is newer than this resource supports`,
      );
    }
    if (version === 0) {
      this.database.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE phone_accounts (
          character_id TEXT PRIMARY KEY,
          phone_number TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE phone_contacts (
          id INTEGER PRIMARY KEY,
          owner_character_id TEXT NOT NULL
            REFERENCES phone_accounts(character_id) ON DELETE CASCADE,
          contact_number TEXT NOT NULL
            REFERENCES phone_accounts(phone_number) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_character_id, contact_number)
        ) STRICT;

        CREATE INDEX phone_contacts_owner_idx
          ON phone_contacts(owner_character_id, name);

        CREATE TABLE phone_messages (
          id INTEGER PRIMARY KEY,
          sender_number TEXT NOT NULL
            REFERENCES phone_accounts(phone_number) ON DELETE CASCADE,
          recipient_number TEXT NOT NULL
            REFERENCES phone_accounts(phone_number) ON DELETE CASCADE,
          body TEXT NOT NULL,
          client_nonce TEXT NOT NULL,
          sent_at TEXT NOT NULL,
          read_at TEXT,
          UNIQUE (sender_number, client_nonce)
        ) STRICT;

        CREATE INDEX phone_messages_sender_idx
          ON phone_messages(sender_number, id DESC);
        CREATE INDEX phone_messages_recipient_idx
          ON phone_messages(recipient_number, id DESC);
        CREATE INDEX phone_messages_unread_idx
          ON phone_messages(recipient_number, read_at, id DESC);

        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  prepare() {
    this.statements = {
      accountByCharacter: this.database.prepare(`
        SELECT * FROM phone_accounts WHERE character_id = ?
      `),
      accountByNumber: this.database.prepare(`
        SELECT * FROM phone_accounts WHERE phone_number = ?
      `),
      insertAccount: this.database.prepare(`
        INSERT INTO phone_accounts (
          character_id, phone_number, created_at, updated_at
        ) VALUES (?, ?, ?, ?)
      `),
      listContacts: this.database.prepare(`
        SELECT * FROM phone_contacts
        WHERE owner_character_id = ?
        ORDER BY name COLLATE NOCASE ASC, id ASC
      `),
      contactById: this.database.prepare(`
        SELECT * FROM phone_contacts
        WHERE owner_character_id = ? AND id = ?
      `),
      contactByNumber: this.database.prepare(`
        SELECT * FROM phone_contacts
        WHERE owner_character_id = ? AND contact_number = ?
      `),
      insertContact: this.database.prepare(`
        INSERT INTO phone_contacts (
          owner_character_id, contact_number, name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `),
      updateContact: this.database.prepare(`
        UPDATE phone_contacts
        SET name = ?, updated_at = ?
        WHERE owner_character_id = ? AND id = ?
      `),
      deleteContact: this.database.prepare(`
        DELETE FROM phone_contacts
        WHERE owner_character_id = ? AND id = ?
      `),
      recentMessages: this.database.prepare(`
        SELECT * FROM phone_messages
        WHERE sender_number = ? OR recipient_number = ?
        ORDER BY id DESC
        LIMIT ?
      `),
      conversation: this.database.prepare(`
        SELECT * FROM phone_messages
        WHERE (
          (sender_number = ? AND recipient_number = ?)
          OR
          (sender_number = ? AND recipient_number = ?)
        )
        AND (? IS NULL OR id < ?)
        ORDER BY id DESC
        LIMIT ?
      `),
      messageByNonce: this.database.prepare(`
        SELECT * FROM phone_messages
        WHERE sender_number = ? AND client_nonce = ?
      `),
      insertMessage: this.database.prepare(`
        INSERT INTO phone_messages (
          sender_number,
          recipient_number,
          body,
          client_nonce,
          sent_at,
          read_at
        ) VALUES (?, ?, ?, ?, ?, NULL)
      `),
      messageById: this.database.prepare(`
        SELECT * FROM phone_messages WHERE id = ?
      `),
      markRead: this.database.prepare(`
        UPDATE phone_messages
        SET read_at = ?
        WHERE recipient_number = ? AND sender_number = ? AND read_at IS NULL
      `),
      deleteAccount: this.database.prepare(`
        DELETE FROM phone_accounts WHERE character_id = ?
      `),
    };
  }

  makeNumber() {
    const suffixLength = this.numberLength - this.numberPrefix.length;
    const maximum = 10 ** suffixLength;
    return `${this.numberPrefix}${String(crypto.randomInt(0, maximum)).padStart(
      suffixLength,
      '0',
    )}`;
  }

  ensureAccount(characterId) {
    let account = this.getAccountByCharacter(characterId);
    if (account) {
      return account;
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const phoneNumber = this.makeNumber();
      if (this.getAccountByNumber(phoneNumber)) {
        continue;
      }
      const timestamp = nowIso();
      try {
        this.statements.insertAccount.run(
          characterId,
          phoneNumber,
          timestamp,
          timestamp,
        );
        return this.getAccountByCharacter(characterId);
      } catch (error) {
        if (!String(error?.message).includes('UNIQUE')) {
          throw error;
        }
      }
    }
    throw phoneError('NUMBER_EXHAUSTED', 'a unique phone number could not be issued');
  }

  getAccountByCharacter(characterId) {
    return hydrateAccount(this.statements.accountByCharacter.get(characterId));
  }

  getAccountByNumber(phoneNumber) {
    return hydrateAccount(this.statements.accountByNumber.get(phoneNumber));
  }

  listContacts(characterId) {
    return this.statements.listContacts.all(characterId).map(hydrateContact);
  }

  getContact(characterId, id) {
    return hydrateContact(this.statements.contactById.get(characterId, id));
  }

  getContactByNumber(characterId, phoneNumber) {
    return hydrateContact(
      this.statements.contactByNumber.get(characterId, phoneNumber),
    );
  }

  createContact(characterId, phoneNumber, name) {
    const timestamp = nowIso();
    const result = this.statements.insertContact.run(
      characterId,
      phoneNumber,
      name,
      timestamp,
      timestamp,
    );
    return this.getContact(characterId, Number(result.lastInsertRowid));
  }

  updateContact(characterId, id, name) {
    const result = this.statements.updateContact.run(
      name,
      nowIso(),
      characterId,
      id,
    );
    return Number(result.changes) === 1
      ? this.getContact(characterId, id)
      : null;
  }

  deleteContact(characterId, id) {
    return (
      Number(this.statements.deleteContact.run(characterId, id).changes) === 1
    );
  }

  recentMessages(phoneNumber, limit = 500) {
    return this.statements.recentMessages
      .all(phoneNumber, phoneNumber, limit)
      .map(hydrateMessage);
  }

  conversation(phoneNumber, peerNumber, beforeId, limit) {
    const cursor = beforeId || null;
    return this.statements.conversation
      .all(
        phoneNumber,
        peerNumber,
        peerNumber,
        phoneNumber,
        cursor,
        cursor,
        limit,
      )
      .map(hydrateMessage);
  }

  sendMessage(senderNumber, recipientNumber, body, clientNonce) {
    const existing = hydrateMessage(
      this.statements.messageByNonce.get(senderNumber, clientNonce),
    );
    if (existing) {
      return { message: existing, duplicate: true };
    }
    const result = this.statements.insertMessage.run(
      senderNumber,
      recipientNumber,
      body,
      clientNonce,
      nowIso(),
    );
    return {
      message: hydrateMessage(
        this.statements.messageById.get(Number(result.lastInsertRowid)),
      ),
      duplicate: false,
    };
  }

  markRead(phoneNumber, peerNumber) {
    const timestamp = nowIso();
    const result = this.statements.markRead.run(
      timestamp,
      phoneNumber,
      peerNumber,
    );
    return { count: Number(result.changes), readAt: timestamp };
  }

  deleteCharacter(characterId) {
    return (
      Number(this.statements.deleteAccount.run(characterId).changes) === 1
    );
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  PhoneDatabase,
};
