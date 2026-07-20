'use strict';

const crypto = require('node:crypto');
const { phoneError } = require('./errors');

const CHARACTER_ID_PATTERN = /^vrd_[a-f0-9]{16}$/;
const NONCE_PATTERN = /^[A-Za-z0-9:_.-]{8,96}$/;

function integer(value, minimum, maximum, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw phoneError(
      'VALIDATION_ERROR',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

function text(value, minimum, maximum, label) {
  const result = String(value || '').trim();
  const length = [...result].length;
  if (length < minimum || length > maximum) {
    throw phoneError(
      'VALIDATION_ERROR',
      `${label} must contain ${minimum}-${maximum} characters`,
    );
  }
  return result;
}

class PhoneService {
  constructor(database, config, integrations, runtime) {
    this.database = database;
    this.config = config;
    this.integrations = integrations;
    this.runtime = runtime;
  }

  phoneNumber(value) {
    const number = String(value || '').replace(/\s+/g, '');
    if (
      !new RegExp(`^\\d{${this.config.numberLength}}$`).test(number) ||
      !number.startsWith(this.config.numberPrefix)
    ) {
      throw phoneError('NUMBER_INVALID', 'phone number is invalid');
    }
    return number;
  }

  resolveCharacterId(identifier) {
    if (
      typeof identifier === 'string' &&
      CHARACTER_ID_PATTERN.test(identifier)
    ) {
      return identifier;
    }
    const player = this.integrations.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw phoneError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    return player.characterId;
  }

  resolveOnline(identifier) {
    const player = this.integrations.core.getPlayerData(identifier);
    if (!player?.characterId) {
      throw phoneError('PLAYER_NOT_FOUND', 'online player was not found');
    }
    const source =
      typeof identifier === 'number' || /^\d+$/.test(String(identifier))
        ? Number(identifier)
        : Number(
            this.integrations.core.getPlayerSource(player.characterId),
          );
    if (!Number.isSafeInteger(source) || source <= 0) {
      throw phoneError('PLAYER_NOT_FOUND', 'online player source was not found');
    }
    this.requireHardware(source);
    return { source, characterId: player.characterId, player };
  }

  requireHardware(source) {
    if (
      this.config.requirePhoneItem &&
      !this.integrations.inventory.hasItem(
        source,
        this.config.phoneItem,
        1,
      )
    ) {
      throw phoneError('PHONE_REQUIRED', 'a phone item is required');
    }
  }

  ensureAccount(characterId) {
    return this.database.ensureAccount(characterId);
  }

  account(identifier) {
    return this.ensureAccount(this.resolveCharacterId(identifier));
  }

  contactName(characterId, phoneNumber) {
    return (
      this.database.getContactByNumber(characterId, phoneNumber)?.name ||
      phoneNumber
    );
  }

  decorateMessage(message, account, contactOwnerId = account.characterId) {
    const incoming = message.recipientNumber === account.phoneNumber;
    const peerNumber = incoming
      ? message.senderNumber
      : message.recipientNumber;
    return {
      id: message.id,
      direction: incoming ? 'incoming' : 'outgoing',
      peerNumber,
      peerName: this.contactName(contactOwnerId, peerNumber),
      body: message.body,
      sentAt: message.sentAt,
      readAt: message.readAt,
    };
  }

  conversations(account) {
    const grouped = new Map();
    for (const message of this.database.recentMessages(
      account.phoneNumber,
      500,
    )) {
      const incoming = message.recipientNumber === account.phoneNumber;
      const peerNumber = incoming
        ? message.senderNumber
        : message.recipientNumber;
      let conversation = grouped.get(peerNumber);
      if (!conversation) {
        conversation = {
          phoneNumber: peerNumber,
          name: this.contactName(account.characterId, peerNumber),
          unread: 0,
          lastMessage: this.decorateMessage(message, account),
        };
        grouped.set(peerNumber, conversation);
      }
      if (incoming && !message.readAt) {
        conversation.unread += 1;
      }
    }
    return [...grouped.values()].sort(
      (left, right) => right.lastMessage.id - left.lastMessage.id,
    );
  }

  bootstrap(identifier) {
    const online = this.resolveOnline(identifier);
    const account = this.ensureAccount(online.characterId);
    const conversations = this.conversations(account);
    return {
      account,
      contacts: this.database.listContacts(online.characterId),
      conversations,
      unread: conversations.reduce(
        (total, conversation) => total + conversation.unread,
        0,
      ),
    };
  }

  createContact(identifier, value) {
    const online = this.resolveOnline(identifier);
    const account = this.ensureAccount(online.characterId);
    const phoneNumber = this.phoneNumber(value?.phoneNumber);
    const name = text(value?.name, 1, 48, 'contact name');
    if (phoneNumber === account.phoneNumber) {
      throw phoneError('CONTACT_SELF', 'your own number cannot be a contact');
    }
    if (!this.database.getAccountByNumber(phoneNumber)) {
      throw phoneError('NUMBER_NOT_FOUND', 'phone number is not registered');
    }
    if (this.database.listContacts(online.characterId).length >= 100) {
      throw phoneError('CONTACT_LIMIT', 'contact limit reached');
    }
    if (this.database.getContactByNumber(online.characterId, phoneNumber)) {
      throw phoneError('CONTACT_EXISTS', 'that number is already a contact');
    }
    const contact = this.database.createContact(
      online.characterId,
      phoneNumber,
      name,
    );
    this.runtime.emitClient(
      online.source,
      'varde_phone:client:contactsUpdated',
    );
    return contact;
  }

  updateContact(identifier, value) {
    const online = this.resolveOnline(identifier);
    this.ensureAccount(online.characterId);
    const id = integer(value?.id, 1, Number.MAX_SAFE_INTEGER, 'contact id');
    const name = text(value?.name, 1, 48, 'contact name');
    const contact = this.database.updateContact(
      online.characterId,
      id,
      name,
    );
    if (!contact) {
      throw phoneError('CONTACT_NOT_FOUND', 'contact was not found');
    }
    this.runtime.emitClient(
      online.source,
      'varde_phone:client:contactsUpdated',
    );
    return contact;
  }

  deleteContact(identifier, value) {
    const online = this.resolveOnline(identifier);
    this.ensureAccount(online.characterId);
    const id = integer(value?.id, 1, Number.MAX_SAFE_INTEGER, 'contact id');
    if (!this.database.deleteContact(online.characterId, id)) {
      throw phoneError('CONTACT_NOT_FOUND', 'contact was not found');
    }
    this.runtime.emitClient(
      online.source,
      'varde_phone:client:contactsUpdated',
    );
    return true;
  }

  listMessages(identifier, value) {
    const online = this.resolveOnline(identifier);
    const account = this.ensureAccount(online.characterId);
    const peerNumber = this.phoneNumber(value?.phoneNumber);
    if (!this.database.getAccountByNumber(peerNumber)) {
      throw phoneError('NUMBER_NOT_FOUND', 'phone number is not registered');
    }
    const beforeId =
      value?.beforeId === undefined || value?.beforeId === null
        ? null
        : integer(value.beforeId, 1, Number.MAX_SAFE_INTEGER, 'beforeId');
    const messages = this.database
      .conversation(
        account.phoneNumber,
        peerNumber,
        beforeId,
        this.config.conversationPageSize,
      )
      .reverse()
      .map((message) => this.decorateMessage(message, account));

    const read = this.database.markRead(account.phoneNumber, peerNumber);
    if (read.count > 0) {
      const peer = this.database.getAccountByNumber(peerNumber);
      const peerSource = Number(
        this.integrations.core.getPlayerSource(peer.characterId),
      );
      if (Number.isSafeInteger(peerSource) && peerSource > 0) {
        this.runtime.emitClient(
          peerSource,
          'varde_phone:client:messagesRead',
          account.phoneNumber,
          read.readAt,
        );
      }
    }
    return {
      phoneNumber: peerNumber,
      name: this.contactName(online.characterId, peerNumber),
      messages,
      hasMore: messages.length === this.config.conversationPageSize,
    };
  }

  messageBody(value) {
    const body = text(value, 1, this.config.messageMaxLength, 'message');
    if (Buffer.byteLength(body, 'utf8') > 4096) {
      throw phoneError('VALIDATION_ERROR', 'message exceeds 4096 bytes');
    }
    return body;
  }

  clientNonce(value) {
    const nonce = String(value || '');
    if (!NONCE_PATTERN.test(nonce)) {
      throw phoneError('VALIDATION_ERROR', 'message nonce is invalid');
    }
    return nonce;
  }

  deliver(senderAccount, recipientAccount, message) {
    const recipientSource = Number(
      this.integrations.core.getPlayerSource(recipientAccount.characterId),
    );
    if (!Number.isSafeInteger(recipientSource) || recipientSource <= 0) {
      return;
    }
    const incoming = this.decorateMessage(
      message,
      recipientAccount,
      recipientAccount.characterId,
    );
    this.runtime.emitClient(
      recipientSource,
      'varde_phone:client:newMessage',
      incoming,
    );
  }

  send(identifier, value) {
    const online = this.resolveOnline(identifier);
    const sender = this.ensureAccount(online.characterId);
    const recipientNumber = this.phoneNumber(value?.phoneNumber);
    if (recipientNumber === sender.phoneNumber) {
      throw phoneError('MESSAGE_SELF', 'messages to your own number are unsupported');
    }
    const recipient = this.database.getAccountByNumber(recipientNumber);
    if (!recipient) {
      throw phoneError('NUMBER_NOT_FOUND', 'phone number is not registered');
    }
    const result = this.database.sendMessage(
      sender.phoneNumber,
      recipientNumber,
      this.messageBody(value?.body),
      this.clientNonce(value?.clientNonce),
    );
    if (!result.duplicate) {
      this.deliver(sender, recipient, result.message);
    }
    return this.decorateMessage(result.message, sender);
  }

  sendTrusted(fromIdentifier, toNumber, body) {
    const characterId = this.resolveCharacterId(fromIdentifier);
    const sender = this.ensureAccount(characterId);
    const recipientNumber = this.phoneNumber(toNumber);
    if (recipientNumber === sender.phoneNumber) {
      throw phoneError('MESSAGE_SELF', 'messages to the same number are unsupported');
    }
    const recipient = this.database.getAccountByNumber(recipientNumber);
    if (!recipient) {
      throw phoneError('NUMBER_NOT_FOUND', 'phone number is not registered');
    }
    const result = this.database.sendMessage(
      sender.phoneNumber,
      recipientNumber,
      this.messageBody(body),
      `resource:${crypto.randomUUID()}`,
    );
    this.deliver(sender, recipient, result.message);
    return this.decorateMessage(result.message, sender);
  }

  deleteCharacter(characterId) {
    if (!CHARACTER_ID_PATTERN.test(String(characterId))) {
      return false;
    }
    return this.database.deleteCharacter(characterId);
  }
}

module.exports = {
  PhoneService,
};
