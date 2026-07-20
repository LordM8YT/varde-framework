'use strict';

const app = document.querySelector('#app');
const messagesView = document.querySelector('#messages-view');
const threadView = document.querySelector('#thread-view');
const contactsView = document.querySelector('#contacts-view');
const conversationList = document.querySelector('#conversation-list');
const contactList = document.querySelector('#contact-list');
const messageList = document.querySelector('#message-list');
const messagesEmpty = document.querySelector('#messages-empty');
const contactsEmpty = document.querySelector('#contacts-empty');
const headerTitle = document.querySelector('#header-title');
const headerKicker = document.querySelector('#header-kicker');
const backButton = document.querySelector('#back-button');
const tabBar = document.querySelector('#tab-bar');
const unreadBadge = document.querySelector('#unread-badge');
const toast = document.querySelector('#toast');
const contactDialog = document.querySelector('#contact-dialog');

const state = {
  account: null,
  contacts: [],
  conversations: [],
  unread: 0,
  view: 'messages',
  activeThread: null,
  messages: [],
  busy: false,
};

function resourceName() {
  return typeof GetParentResourceName === 'function'
    ? GetParentResourceName()
    : 'varde_phone';
}

async function nui(endpoint, payload = {}) {
  const response = await fetch(`https://${resourceName()}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function request(method, payload = {}) {
  const response = await nui('phoneRequest', { method, payload });
  if (!response.ok) {
    throw new Error(response.error?.message || 'Phone request failed.');
  }
  return response.data;
}

function showToast(text, isError = false) {
  toast.textContent = String(text);
  toast.classList.toggle('is-error', isError);
  toast.classList.remove('is-hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('is-hidden'), 3200);
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return '';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function messageTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hydrate(payload) {
  state.account = payload.account || null;
  state.contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  state.conversations = Array.isArray(payload.conversations)
    ? payload.conversations
    : [];
  state.unread = Number(payload.unread) || 0;
}

function makeAvatar(name) {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = initials(name);
  return avatar;
}

function renderConversations() {
  conversationList.replaceChildren(
    ...state.conversations.map((conversation) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conversation';
      button.dataset.number = conversation.phoneNumber;

      const copy = document.createElement('span');
      copy.className = 'row-copy';
      const name = document.createElement('strong');
      name.textContent = conversation.name || conversation.phoneNumber;
      const preview = document.createElement('small');
      preview.textContent = conversation.lastMessage?.body || 'No messages';
      copy.append(name, preview);

      const meta = document.createElement('span');
      meta.className = 'row-meta';
      const time = document.createElement('span');
      time.textContent = relativeTime(conversation.lastMessage?.sentAt);
      meta.append(time);
      if (conversation.unread > 0) {
        const unread = document.createElement('span');
        unread.className = 'unread-dot';
        unread.textContent = String(conversation.unread);
        meta.append(unread);
      }
      button.append(makeAvatar(conversation.name), copy, meta);
      return button;
    }),
  );
  messagesEmpty.classList.toggle(
    'is-hidden',
    state.conversations.length > 0,
  );
}

function renderContacts() {
  contactList.replaceChildren(
    ...state.contacts.map((contact) => {
      const row = document.createElement('div');
      row.className = 'contact';

      const copy = document.createElement('span');
      copy.className = 'row-copy';
      const name = document.createElement('strong');
      name.textContent = contact.name;
      const number = document.createElement('small');
      number.textContent = contact.phoneNumber;
      copy.append(name, number);

      const actions = document.createElement('span');
      actions.className = 'contact-actions';
      const chat = document.createElement('button');
      chat.type = 'button';
      chat.className = 'mini-button';
      chat.dataset.messageNumber = contact.phoneNumber;
      chat.textContent = 'Text';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini-button is-danger';
      remove.dataset.deleteContact = String(contact.id);
      remove.textContent = 'Delete';
      actions.append(chat, remove);
      row.append(makeAvatar(contact.name), copy, actions);
      return row;
    }),
  );
  contactsEmpty.classList.toggle('is-hidden', state.contacts.length > 0);
}

function renderMessages() {
  messageList.replaceChildren(
    ...state.messages.map((message) => {
      const bubble = document.createElement('article');
      bubble.className = 'bubble';
      bubble.classList.toggle('is-outgoing', message.direction === 'outgoing');
      const body = document.createElement('span');
      body.textContent = message.body;
      const time = document.createElement('time');
      time.dateTime = message.sentAt;
      time.textContent = `${messageTime(message.sentAt)}${
        message.direction === 'outgoing' && message.readAt ? ' · read' : ''
      }`;
      bubble.append(body, time);
      return bubble;
    }),
  );
  messageList.scrollTop = messageList.scrollHeight;
}

function renderChrome() {
  const inThread = state.view === 'thread';
  messagesView.classList.toggle('is-hidden', state.view !== 'messages');
  contactsView.classList.toggle('is-hidden', state.view !== 'contacts');
  threadView.classList.toggle('is-hidden', !inThread);
  backButton.classList.toggle('is-hidden', !inThread);
  tabBar.classList.toggle('is-hidden', inThread);

  if (inThread) {
    headerKicker.textContent = state.activeThread?.phoneNumber || 'Conversation';
    headerTitle.textContent =
      state.activeThread?.name || state.activeThread?.phoneNumber || 'Messages';
  } else {
    headerKicker.textContent = state.account?.phoneNumber || 'Varde Phone';
    headerTitle.textContent =
      state.view === 'contacts' ? 'Contacts' : 'Messages';
  }

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === state.view);
  });
  unreadBadge.textContent = String(state.unread);
  unreadBadge.classList.toggle('is-hidden', state.unread <= 0);
}

function render() {
  renderChrome();
  renderConversations();
  renderContacts();
  renderMessages();
}

async function refresh() {
  const bootstrap = await request('bootstrap');
  hydrate(bootstrap);
  render();
}

async function openThread(phoneNumber) {
  try {
    const result = await request('messages:list', { phoneNumber });
    state.activeThread = {
      phoneNumber: result.phoneNumber,
      name: result.name,
    };
    state.messages = result.messages || [];
    state.view = 'thread';
    const conversation = state.conversations.find(
      (entry) => entry.phoneNumber === phoneNumber,
    );
    if (conversation) {
      state.unread = Math.max(0, state.unread - conversation.unread);
      conversation.unread = 0;
    }
    render();
  } catch (error) {
    showToast(error.message, true);
  }
}

conversationList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-number]');
  if (row) {
    openThread(row.dataset.number);
  }
});

contactList.addEventListener('click', async (event) => {
  const messageButton = event.target.closest('[data-message-number]');
  if (messageButton) {
    openThread(messageButton.dataset.messageNumber);
    return;
  }
  const deleteButton = event.target.closest('[data-delete-contact]');
  if (deleteButton && !state.busy) {
    state.busy = true;
    try {
      await request('contacts:delete', {
        id: Number(deleteButton.dataset.deleteContact),
      });
      await refresh();
      showToast('Contact deleted.');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      state.busy = false;
    }
  }
});

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    state.activeThread = null;
    state.messages = [];
    render();
  });
});

backButton.addEventListener('click', async () => {
  state.view = 'messages';
  state.activeThread = null;
  state.messages = [];
  await refresh().catch((error) => showToast(error.message, true));
});

document.querySelector('#message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy || !state.activeThread) {
    return;
  }
  const input = document.querySelector('#message-input');
  const body = input.value.trim();
  if (!body) {
    return;
  }
  state.busy = true;
  try {
    const nonce =
      globalThis.crypto?.randomUUID?.() ||
      `browser:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const sent = await request('messages:send', {
      phoneNumber: state.activeThread.phoneNumber,
      body,
      clientNonce: nonce,
    });
    state.messages.push(sent);
    input.value = '';
    renderMessages();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.busy = false;
  }
});

document.querySelector('#add-contact-button').addEventListener('click', () => {
  contactDialog.showModal();
});

document.querySelector('#contact-cancel').addEventListener('click', () => {
  contactDialog.close();
});

document.querySelector('#contact-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) {
    return;
  }
  state.busy = true;
  const data = new FormData(event.currentTarget);
  try {
    await request('contacts:create', {
      name: data.get('name'),
      phoneNumber: data.get('phoneNumber'),
    });
    contactDialog.close();
    event.currentTarget.reset();
    await refresh();
    state.view = 'contacts';
    render();
    showToast('Contact saved.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.busy = false;
  }
});

async function close() {
  app.classList.add('is-hidden');
  state.activeThread = null;
  state.messages = [];
  await nui('close');
}

document.querySelector('#close-button').addEventListener('click', close);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (contactDialog.open) {
      contactDialog.close();
    } else if (state.view === 'thread') {
      backButton.click();
    } else {
      close();
    }
  }
});

window.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  if (type === 'open' || type === 'bootstrap') {
    hydrate(payload || {});
    if (type === 'open') {
      state.view = 'messages';
      state.activeThread = null;
      state.messages = [];
      app.classList.remove('is-hidden');
    }
    render();
  } else if (type === 'newMessage') {
    if (
      state.view === 'thread' &&
      state.activeThread?.phoneNumber === payload.peerNumber
    ) {
      state.messages.push(payload);
      renderMessages();
      request('messages:list', { phoneNumber: payload.peerNumber }).catch(() => {});
    } else {
      let conversation = state.conversations.find(
        (entry) => entry.phoneNumber === payload.peerNumber,
      );
      if (!conversation) {
        conversation = {
          phoneNumber: payload.peerNumber,
          name: payload.peerName,
          unread: 0,
          lastMessage: payload,
        };
        state.conversations.unshift(conversation);
      }
      conversation.lastMessage = payload;
      conversation.unread += 1;
      state.unread += 1;
      render();
    }
  } else if (type === 'messagesRead') {
    for (const message of state.messages) {
      if (
        message.direction === 'outgoing' &&
        state.activeThread?.phoneNumber === payload.phoneNumber &&
        !message.readAt
      ) {
        message.readAt = payload.readAt;
      }
    }
    renderMessages();
  } else if (type === 'close') {
    app.classList.add('is-hidden');
  }
});

function updateClock() {
  document.querySelector('#clock').textContent = new Date().toLocaleTimeString(
    [],
    { hour: '2-digit', minute: '2-digit' },
  );
}

updateClock();
setInterval(updateClock, 15000);
