'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PhoneDatabase } = require('../server/database');
const { PhoneService } = require('../server/service');
const { validateConfig } = require('../server/config');

function createHarness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varde-phone-'));
  const config = validateConfig(
    {
      databaseFile: 'phone.sqlite',
      numberPrefix: '5',
      numberLength: 8,
      requirePhoneItem: options.requirePhoneItem === true,
      phoneItem: 'phone',
      messageMaxLength: 500,
      conversationPageSize: 50,
    },
    directory,
  );
  const database = new PhoneDatabase(
    config.databaseFile,
    config.numberPrefix,
    config.numberLength,
  );
  const players = new Map([
    [
      7,
      {
        characterId: 'vrd_0123456789abcdef',
        profile: { firstName: 'Sender', lastName: 'Test' },
      },
    ],
    [
      8,
      {
        characterId: 'vrd_fedcba9876543210',
        profile: { firstName: 'Recipient', lastName: 'Test' },
      },
    ],
  ]);
  const events = [];
  const integrations = {
    core: {
      getPlayerData(identifier) {
        if (typeof identifier === 'string' && identifier.startsWith('vrd_')) {
          return (
            [...players.values()].find(
              (player) => player.characterId === identifier,
            ) || null
          );
        }
        return players.get(Number(identifier)) || null;
      },
      getPlayerSource(characterId) {
        for (const [source, player] of players) {
          if (player.characterId === characterId) {
            return source;
          }
        }
        return 0;
      },
    },
    inventory: {
      hasItem() {
        return options.hasPhone !== false;
      },
    },
  };
  const runtime = {
    emitClient(source, eventName, ...args) {
      events.push({ source, eventName, args });
    },
  };
  const service = new PhoneService(database, config, integrations, runtime);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { service, database, events, players };
}

test('contacts and offline-capable text messages form a private lifecycle', (t) => {
  const { service, events } = createHarness(t);
  const sender = service.bootstrap(7);
  const recipient = service.bootstrap(8);
  service.createContact(7, {
    phoneNumber: recipient.account.phoneNumber,
    name: 'Recipient',
  });

  const sent = service.send(7, {
    phoneNumber: recipient.account.phoneNumber,
    body: 'Hei fra Varde',
    clientNonce: 'client:test:0001',
  });
  assert.equal(sent.direction, 'outgoing');
  assert.equal(
    events.some(
      (event) =>
        event.source === 8 &&
        event.eventName === 'varde_phone:client:newMessage',
    ),
    true,
  );

  const received = service.listMessages(8, {
    phoneNumber: sender.account.phoneNumber,
  });
  assert.equal(received.messages[0].direction, 'incoming');
  assert.equal(received.messages[0].body, 'Hei fra Varde');
  assert.equal(
    events.some(
      (event) =>
        event.source === 7 &&
        event.eventName === 'varde_phone:client:messagesRead',
    ),
    true,
  );
  assert.equal(service.bootstrap(8).unread, 0);
});

test('message nonces prevent a client retry from duplicating a text', (t) => {
  const { service, database } = createHarness(t);
  const sender = service.bootstrap(7);
  const recipient = service.bootstrap(8);
  const payload = {
    phoneNumber: recipient.account.phoneNumber,
    body: 'Once',
    clientNonce: 'client:test:retry',
  };

  service.send(7, payload);
  service.send(7, payload);
  assert.equal(database.recentMessages(sender.account.phoneNumber).length, 1);
});

test('hardware requirement is optional and server-enforced', (t) => {
  const { service } = createHarness(t, {
    requirePhoneItem: true,
    hasPhone: false,
  });
  assert.throws(() => service.bootstrap(7), { code: 'PHONE_REQUIRED' });
});

test('trusted resources can send to offline accounts', (t) => {
  const { service, players } = createHarness(t);
  const sender = service.bootstrap(7);
  const recipient = service.bootstrap(8);
  players.delete(8);

  const sent = service.sendTrusted(
    sender.account.characterId,
    recipient.account.phoneNumber,
    'Offline message',
  );
  assert.equal(sent.body, 'Offline message');
});
