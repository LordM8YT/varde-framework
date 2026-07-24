'use strict';

const app = document.querySelector('#app');
const playerList = document.querySelector('#player-list');
const playerCount = document.querySelector('#player-count');
const searchInput = document.querySelector('#player-search');
const emptyState = document.querySelector('#empty-state');
const playerDetail = document.querySelector('#player-detail');
const auditPanel = document.querySelector('#audit-panel');
const auditList = document.querySelector('#audit-list');
const toast = document.querySelector('#toast');
const kickDialog = document.querySelector('#kick-dialog');

const state = {
  players: [],
  permissions: {},
  selectedSource: null,
  busy: false,
  locale: {},
  localeName: 'en',
};

function translation(key) {
  let current = state.locale;
  for (const part of String(key).split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function t(key, replacements = {}, fallback = key) {
  const value = translation(key) || fallback;
  return String(value).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, name) => (
    replacements[name] === undefined ? match : String(replacements[name])
  ));
}

function applyStaticLocale() {
  document.documentElement.lang = state.localeName;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(
      element.dataset.i18n,
      {},
      element.textContent.trim(),
    );
  });
  const attributes = [
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-value', 'value'],
  ];
  for (const [dataAttribute, attribute] of attributes) {
    document.querySelectorAll(`[${dataAttribute}]`).forEach((element) => {
      const key = element.getAttribute(dataAttribute);
      element.setAttribute(
        attribute,
        t(key, {}, element.getAttribute(attribute) || ''),
      );
    });
  }
}

function resourceName() {
  return typeof GetParentResourceName === 'function'
    ? GetParentResourceName()
    : 'varde_admin';
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
  const response = await nui('adminRequest', { method, payload });
  if (!response.ok) {
    throw new Error(
      response.error?.message
        || t('errors.actionFailed', {}, 'Admin action failed.'),
    );
  }
  return response.data;
}

function escapeText(value) {
  return String(value ?? '');
}

function showToast(text, isError = false) {
  toast.textContent = text;
  toast.classList.toggle('is-error', isError);
  toast.classList.remove('is-hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('is-hidden'), 3500);
}

function selectedPlayer() {
  return state.players.find((player) => player.source === state.selectedSource);
}

function hasPermission(permission) {
  return state.permissions['varde.admin'] || state.permissions[permission];
}

function jobLabel(job) {
  if (!job) return t('ui.noJob', {}, 'No job');
  return t(`labels.jobs.${job.name}.label`, {}, job.label || job.name);
}

function gradeLabel(job) {
  if (!job) return '';
  return t(
    `labels.jobs.${job.name}.grades.${job.grade}`,
    {},
    job.gradeLabel || t(
      'ui.gradeNumber',
      { grade: job.grade },
      `Grade ${job.grade}`,
    ),
  );
}

function applyPermissions() {
  document.querySelectorAll('[data-permission]').forEach((element) => {
    element.classList.toggle(
      'is-hidden',
      !hasPermission(element.dataset.permission),
    );
  });
  document.querySelector('#audit-button').classList.toggle(
    'is-hidden',
    !hasPermission('varde.admin.audit'),
  );
}

function renderPlayers() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = state.players.filter((player) => {
    const haystack = [
      player.source,
      player.name,
      player.serverName,
      player.characterId,
      player.job?.name,
      player.job?.label,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
  playerCount.textContent = String(state.players.length);
  playerList.replaceChildren(
    ...visible.map((player) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'player-card';
      button.classList.toggle('is-selected', player.source === state.selectedSource);
      button.dataset.source = String(player.source);

      const badge = document.createElement('span');
      badge.className = 'source-badge';
      badge.textContent = String(player.source);

      const identity = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = player.name || player.serverName;
      const job = document.createElement('small');
      job.textContent = player.job
        ? jobLabel(player.job)
        : t('ui.noActiveJob', {}, 'No active job');
      identity.append(name, job);

      const ping = document.createElement('span');
      ping.className = 'ping';
      ping.textContent = `${player.ping} ms`;
      button.append(badge, identity, ping);
      return button;
    }),
  );
}

function renderDetail() {
  const player = selectedPlayer();
  emptyState.classList.toggle('is-hidden', Boolean(player));
  playerDetail.classList.toggle('is-hidden', !player);
  if (!player) {
    return;
  }

  document.querySelector('#selected-source').textContent = t(
    'ui.source',
    { source: player.source, serverName: player.serverName },
    `Source ${player.source} · ${player.serverName}`,
  );
  document.querySelector('#selected-name').textContent =
    player.name || player.serverName;
  document.querySelector('#selected-character').textContent = player.characterId;
  document.querySelector('#selected-job').textContent = player.job
    ? t(
      'ui.jobGrade',
      {
        job: jobLabel(player.job),
        grade: gradeLabel(player.job),
      },
      `${jobLabel(player.job)} · ${gradeLabel(player.job)}`,
    )
    : t('ui.noJob', {}, 'No job');
  document.querySelector('#selected-ping').textContent = `${player.ping} ms`;
  document.querySelector('#freeze-button').textContent = player.frozen
    ? t('ui.unfreeze', {}, 'Unfreeze')
    : t('ui.freeze', {}, 'Freeze');
}

function render() {
  applyPermissions();
  renderPlayers();
  renderDetail();
}

async function refreshPlayers() {
  state.players = await request('players:list');
  if (
    state.selectedSource !== null &&
    !state.players.some((player) => player.source === state.selectedSource)
  ) {
    state.selectedSource = null;
  }
  render();
}

async function runAction(
  method,
  payload = {},
  successMessage = t('ui.actionCompleted', {}, 'Action completed.'),
) {
  if (state.busy) {
    return;
  }
  const player = selectedPlayer();
  if (!player) {
    showToast(t('ui.choosePlayerFirst', {}, 'Choose a player first.'), true);
    return;
  }
  state.busy = true;
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = true;
  });
  try {
    await request(method, { target: player.source, ...payload });
    showToast(successMessage);
    await refreshPlayers();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.busy = false;
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = false;
    });
  }
}

playerList.addEventListener('click', (event) => {
  const card = event.target.closest('[data-source]');
  if (!card) {
    return;
  }
  state.selectedSource = Number(card.dataset.source);
  auditPanel.classList.add('is-hidden');
  render();
});

searchInput.addEventListener('input', renderPlayers);

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const method = button.dataset.action;
    const player = selectedPlayer();
    const payload =
      method === 'player:freeze' ? { frozen: !player?.frozen } : {};
    runAction(method, payload);
  });
});

document.querySelector('#economy-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  runAction(
    'economy:set',
    { currency: data.get('currency'), amount: Number(data.get('amount')) },
    t('ui.balanceUpdated', {}, 'Balance updated.'),
  );
});

document.querySelector('#job-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  runAction(
    'job:assign',
    { jobName: data.get('jobName'), grade: Number(data.get('grade')) },
    t('ui.jobAssigned', {}, 'Job assigned.'),
  );
});

document.querySelector('#inventory-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  runAction(
    'inventory:add',
    { itemName: data.get('itemName'), amount: Number(data.get('amount')) },
    t('ui.itemAdded', {}, 'Item added.'),
  );
});

document.querySelector('#kick-button').addEventListener('click', () => {
  kickDialog.showModal();
});

document.querySelector('#kick-cancel').addEventListener('click', () => {
  kickDialog.close();
});

document.querySelector('#kick-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  kickDialog.close();
  runAction(
    'player:kick',
    { reason: data.get('reason') },
    t('ui.playerRemoved', {}, 'Player removed.'),
  );
});

document.querySelector('#refresh-button').addEventListener('click', async () => {
  try {
    await refreshPlayers();
    showToast(t('ui.playersRefreshed', {}, 'Player list refreshed.'));
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector('#audit-button').addEventListener('click', async () => {
  try {
    const entries = await request('audit:list', { limit: 100 });
    auditList.replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement('article');
        row.className = 'audit-row';

        const time = document.createElement('span');
        const date = new Date(entry.createdAt);
        time.textContent = Number.isNaN(date.valueOf())
          ? entry.createdAt
          : date.toLocaleString(state.localeName);

        const detail = document.createElement('span');
        const action = document.createElement('strong');
        action.textContent = escapeText(entry.action);
        const actors = document.createElement('small');
        actors.textContent = t(
          'ui.actorTarget',
          {
            actor: entry.actorSource,
            target: entry.targetSource || t('ui.system', {}, 'system'),
          },
          `Actor ${entry.actorSource} → ${entry.targetSource || 'system'}`,
        );
        detail.append(action, actors);

        const status = document.createElement('span');
        status.className = 'audit-status';
        status.classList.toggle('is-failure', entry.status === 'failure');
        status.textContent = entry.status === 'failure'
          ? t('ui.statusFailure', {}, 'failure')
          : t('ui.statusSuccess', {}, entry.status || 'success');
        row.append(time, detail, status);
        return row;
      }),
    );
    auditPanel.classList.remove('is-hidden');
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector('#audit-close').addEventListener('click', () => {
  auditPanel.classList.add('is-hidden');
});

async function close() {
  app.classList.add('is-hidden');
  state.players = [];
  state.selectedSource = null;
  await nui('close');
}

document.querySelector('#close-button').addEventListener('click', close);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (kickDialog.open) {
      kickDialog.close();
    } else if (!auditPanel.classList.contains('is-hidden')) {
      auditPanel.classList.add('is-hidden');
    } else {
      close();
    }
  }
});

window.addEventListener('message', (event) => {
  if (event.data?.type === 'open') {
    const payload = event.data.payload || {};
    state.locale = event.data.locale && typeof event.data.locale === 'object'
      ? event.data.locale
      : state.locale;
    state.localeName = event.data.localeName || state.localeName;
    applyStaticLocale();
    state.players = Array.isArray(payload.players) ? payload.players : [];
    state.permissions = payload.permissions || {};
    state.selectedSource = null;
    app.classList.remove('is-hidden');
    auditPanel.classList.add('is-hidden');
    searchInput.value = '';
    render();
  } else if (event.data?.type === 'close') {
    app.classList.add('is-hidden');
  }
});
