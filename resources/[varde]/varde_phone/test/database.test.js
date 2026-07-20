'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PhoneDatabase } = require('../server/database');

function createDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-phone-db-'));
  const database = new PhoneDatabase(
    path.join(directory, 'phone.sqlite'),
    '5',
    8,
  );
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

test('accounts receive unique stable phone numbers', (t) => {
  const database = createDatabase(t);
  const first = database.ensureAccount('vrd_0123456789abcdef');
  const second = database.ensureAccount('vrd_fedcba9876543210');

  assert.match(first.phoneNumber, /^5\d{7}$/);
  assert.notEqual(first.phoneNumber, second.phoneNumber);
  assert.equal(
    database.ensureAccount('vrd_0123456789abcdef').phoneNumber,
    first.phoneNumber,
  );
});

test('contacts, idempotent messages, read state, and cascade form one lifecycle', (t) => {
  const database = createDatabase(t);
  const sender = database.ensureAccount('vrd_0123456789abcdef');
  const recipient = database.ensureAccount('vrd_fedcba9876543210');
  const contact = database.createContact(
    sender.characterId,
    recipient.phoneNumber,
    'Recipient',
  );
  assert.equal(contact.name, 'Recipient');

  const sent = database.sendMessage(
    sender.phoneNumber,
    recipient.phoneNumber,
    'Hello',
    'nonce:test:0001',
  );
  const duplicate = database.sendMessage(
    sender.phoneNumber,
    recipient.phoneNumber,
    'Hello',
    'nonce:test:0001',
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.message.id, sent.message.id);
  assert.equal(
    database.conversation(sender.phoneNumber, recipient.phoneNumber, null, 50)
      .length,
    1,
  );

  const read = database.markRead(recipient.phoneNumber, sender.phoneNumber);
  assert.equal(read.count, 1);
  assert.ok(
    database.conversation(sender.phoneNumber, recipient.phoneNumber, null, 50)[0]
      .readAt,
  );

  assert.equal(database.deleteCharacter(recipient.characterId), true);
  assert.deepEqual(database.listContacts(sender.characterId), []);
  assert.deepEqual(database.recentMessages(sender.phoneNumber), []);
});
