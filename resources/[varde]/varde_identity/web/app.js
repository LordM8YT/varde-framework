'use strict';

const isNui = typeof window.GetParentResourceName === 'function';
const resourceName = isNui ? window.GetParentResourceName() : 'varde_identity';

const state = {
  open: false,
  allowDelete: true,
  maxCharacters: 4,
  characters: [],
  spawns: [],
  selectedCharacterId: null,
  createSlot: null,
  locale: {},
  localeName: 'en',
};

const elements = {
  app: document.querySelector('#app'),
  title: document.querySelector('#brand-title'),
  subtitle: document.querySelector('#brand-subtitle'),
  slotCounter: document.querySelector('#slot-counter'),
  characterList: document.querySelector('#character-list'),
  emptyDetail: document.querySelector('#empty-detail'),
  characterDetail: document.querySelector('#character-detail'),
  createForm: document.querySelector('#create-form'),
  createSlot: document.querySelector('#create-slot'),
  detailName: document.querySelector('#detail-name'),
  detailId: document.querySelector('#detail-id'),
  detailJob: document.querySelector('#detail-job'),
  detailNationality: document.querySelector('#detail-nationality'),
  detailBirthdate: document.querySelector('#detail-birthdate'),
  portraitInitials: document.querySelector('#portrait-initials'),
  spawnSelect: document.querySelector('#spawn-select'),
  spawnDescription: document.querySelector('#spawn-description'),
  playButton: document.querySelector('#play-button'),
  deleteButton: document.querySelector('#delete-button'),
  cancelCreate: document.querySelector('#cancel-create'),
  toast: document.querySelector('#toast'),
  deleteDialog: document.querySelector('#delete-dialog'),
  deleteCopy: document.querySelector('#delete-copy'),
  confirmDelete: document.querySelector('#confirm-delete'),
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
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute(
      'aria-label',
      t(
        element.dataset.i18nAriaLabel,
        {},
        element.getAttribute('aria-label') || '',
      ),
    );
  });
}

async function post(endpoint, payload = {}) {
  if (!isNui) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    return { ok: true, data: true };
  }

  const response = await fetch(`https://${resourceName}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function setBusy(button, busy) {
  if (button) {
    button.disabled = busy;
  }
}

function toast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', error);
  elements.toast.classList.remove('is-hidden');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    elements.toast.classList.add('is-hidden');
  }, 3500);
}

function selectedCharacter() {
  return state.characters.find(
    (character) => character.characterId === state.selectedCharacterId,
  ) || null;
}

function initials(character) {
  return `${character.profile.firstName[0] || ''}${character.profile.lastName[0] || ''}`.toUpperCase();
}

function jobLabel(job) {
  if (!job) return t('ui.unemployed', {}, 'Unemployed');
  return t(
    `labels.jobs.${job.name}.label`,
    {},
    job.label || job.name || t('ui.unemployed', {}, 'Unemployed'),
  );
}

function renderSpawnOptions() {
  elements.spawnSelect.replaceChildren();
  for (const spawn of state.spawns) {
    const option = document.createElement('option');
    option.value = spawn.id;
    option.textContent = spawn.label;
    elements.spawnSelect.append(option);
  }
  updateSpawnDescription();
}

function updateSpawnDescription() {
  const selected = state.spawns.find(
    (spawn) => spawn.id === elements.spawnSelect.value,
  );
  elements.spawnDescription.textContent = selected?.description || '';
}

function renderDetail() {
  const character = selectedCharacter();
  const creating = Number.isInteger(state.createSlot);
  elements.emptyDetail.classList.toggle('is-hidden', Boolean(character) || creating);
  elements.characterDetail.classList.toggle('is-hidden', !character || creating);
  elements.createForm.classList.toggle('is-hidden', !creating);

  if (creating) {
    elements.createSlot.value = String(state.createSlot);
    const firstInput = elements.createForm.querySelector('input[name="firstName"]');
    window.setTimeout(() => firstInput.focus(), 0);
    return;
  }

  if (!character) {
    return;
  }

  const { profile, job } = character;
  elements.detailName.textContent = `${profile.firstName} ${profile.lastName}`;
  elements.detailId.textContent = character.characterId;
  elements.detailJob.textContent = jobLabel(job);
  elements.detailNationality.textContent = profile.nationality;
  elements.detailBirthdate.textContent = profile.birthDate;
  elements.portraitInitials.textContent = initials(character);
  elements.deleteButton.classList.toggle('is-hidden', !state.allowDelete);
  renderSpawnOptions();
}

function renderCharacters() {
  elements.characterList.replaceChildren();
  elements.slotCounter.textContent = t(
    'ui.slots',
    { current: state.characters.length, max: state.maxCharacters },
    `${state.characters.length} / ${state.maxCharacters} slots`,
  );

  for (let slot = 1; slot <= state.maxCharacters; slot += 1) {
    const character = state.characters.find((candidate) => candidate.slot === slot);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'character-card';
    button.dataset.slot = String(slot);

    if (character) {
      button.classList.toggle(
        'is-selected',
        character.characterId === state.selectedCharacterId,
      );
      button.innerHTML = `
        <div class="card-top">
          <span class="slot-number"></span>
          <small></small>
        </div>
        <strong></strong>
      `;
      button.querySelector('.slot-number').textContent = t(
        'ui.slot',
        { slot: String(slot).padStart(2, '0') },
        `SLOT ${String(slot).padStart(2, '0')}`,
      );
      button.querySelector('small').textContent = jobLabel(character.job);
      button.querySelector('strong').textContent =
        `${character.profile.firstName} ${character.profile.lastName}`;
      button.addEventListener('click', () => {
        state.selectedCharacterId = character.characterId;
        state.createSlot = null;
        render();
      });
    } else {
      button.classList.add('is-empty');
      button.innerHTML = `
        <div class="card-top">
          <span class="slot-number"></span>
          <small></small>
        </div>
        <strong></strong>
      `;
      button.querySelector('.slot-number').textContent = t(
        'ui.slot',
        { slot: String(slot).padStart(2, '0') },
        `SLOT ${String(slot).padStart(2, '0')}`,
      );
      button.querySelector('small').textContent =
        t('ui.available', {}, 'Available');
      button.querySelector('strong').textContent =
        t('ui.createNew', {}, 'Create new identity');
      button.addEventListener('click', () => {
        state.selectedCharacterId = null;
        state.createSlot = slot;
        elements.createForm.reset();
        render();
      });
    }

    elements.characterList.append(button);
  }
}

function render() {
  elements.title.textContent = state.title || 'Varde';
  elements.subtitle.textContent = state.subtitle || 'Choose your path';
  elements.app.classList.toggle('is-hidden', !state.open);
  renderCharacters();
  renderDetail();
}

function applyBootstrap(data) {
  state.locale = data.locale && typeof data.locale === 'object'
    ? data.locale
    : state.locale;
  state.localeName = data.localeName || state.localeName;
  applyStaticLocale();
  state.title = data.title || 'Varde';
  state.subtitle = data.subtitle || 'Choose your path';
  state.allowDelete = data.allowDelete !== false;
  state.maxCharacters = Number(data.maxCharacters) || 4;
  state.characters = Array.isArray(data.characters) ? data.characters : [];
  state.spawns = Array.isArray(data.spawns) ? data.spawns : [];

  if (
    state.selectedCharacterId &&
    !state.characters.some(
      (character) => character.characterId === state.selectedCharacterId,
    )
  ) {
    state.selectedCharacterId = null;
  }
  render();
}

elements.spawnSelect.addEventListener('change', updateSpawnDescription);

elements.cancelCreate.addEventListener('click', () => {
  state.createSlot = null;
  elements.createForm.reset();
  render();
});

elements.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = elements.createForm.querySelector('[type="submit"]');
  setBusy(submitButton, true);
  const form = new FormData(elements.createForm);
  const response = await post('createCharacter', {
    slot: Number(form.get('slot')),
    firstName: form.get('firstName'),
    lastName: form.get('lastName'),
    birthDate: form.get('birthDate'),
    gender: form.get('gender'),
    nationality: form.get('nationality'),
  });
  setBusy(submitButton, false);

  if (!response.ok) {
    toast(
      response.error?.message
        || t('ui.createFailed', {}, 'Character could not be created.'),
      true,
    );
    return;
  }

  if (!isNui) {
    state.characters.push({
      characterId: `vrd_preview_${Date.now()}`,
      slot: Number(form.get('slot')),
      profile: {
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
        birthDate: form.get('birthDate'),
        gender: form.get('gender'),
        nationality: form.get('nationality'),
      },
      job: { name: 'unemployed', label: 'Unemployed', grade: 0, onDuty: false },
    });
  }

  state.createSlot = null;
  elements.createForm.reset();
  toast(t('ui.created', {}, 'Identity created.'));
  render();
});

elements.playButton.addEventListener('click', async () => {
  const character = selectedCharacter();
  if (!character) return;

  setBusy(elements.playButton, true);
  const response = await post('selectCharacter', {
    characterId: character.characterId,
    spawnId: elements.spawnSelect.value,
  });
  setBusy(elements.playButton, false);

  if (!response.ok) {
    toast(
      response.error?.message
        || t('ui.selectFailed', {}, 'Character could not be selected.'),
      true,
    );
    return;
  }
  if (!isNui) {
    toast(t(
      'ui.enteringAs',
      { name: character.profile.firstName },
      `Entering as ${character.profile.firstName}.`,
    ));
  }
});

elements.deleteButton.addEventListener('click', () => {
  const character = selectedCharacter();
  if (!character) return;
  const name = `${character.profile.firstName} ${character.profile.lastName}`;
  elements.deleteCopy.textContent = t(
    'ui.deleteCopy',
    { name },
    `${name} and all associated data will be removed permanently.`,
  );
  elements.deleteDialog.showModal();
});

elements.deleteDialog.addEventListener('close', async () => {
  if (elements.deleteDialog.returnValue !== 'confirm') return;
  const character = selectedCharacter();
  if (!character) return;

  setBusy(elements.confirmDelete, true);
  const response = await post('deleteCharacter', {
    characterId: character.characterId,
  });
  setBusy(elements.confirmDelete, false);

  if (!response.ok) {
    toast(
      response.error?.message
        || t('ui.deleteFailed', {}, 'Character could not be deleted.'),
      true,
    );
    return;
  }

  if (!isNui) {
    state.characters = state.characters.filter(
      (candidate) => candidate.characterId !== character.characterId,
    );
  }
  state.selectedCharacterId = null;
  toast(t('ui.deleted', {}, 'Character deleted.'));
  render();
});

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.action === 'identity:update') {
    applyBootstrap(message.data || {});
  } else if (message.action === 'identity:open') {
    state.open = true;
    render();
  } else if (message.action === 'identity:close') {
    state.open = false;
    render();
  }
});

window.addEventListener('keydown', async (event) => {
  if (event.key !== 'Escape' || !state.open || elements.deleteDialog.open) {
    return;
  }
  const response = await post('close');
  if (!response.ok) {
    toast(
      response.error?.message
        || t('ui.selectFirst', {}, 'Select a character first.'),
      true,
    );
  }
});

if (!isNui) {
  applyBootstrap({
    title: 'Varde',
    subtitle: 'Choose your path',
    allowDelete: true,
    maxCharacters: 4,
    characters: [
      {
        characterId: 'vrd_81a6f90de5cb4210',
        slot: 1,
        profile: {
          firstName: 'Kari',
          lastName: 'Nordmann',
          birthDate: '1995-06-15',
          gender: 'female',
          nationality: 'Norwegian',
        },
        job: {
          name: 'unemployed',
          label: 'Unemployed',
          grade: 0,
          onDuty: false,
        },
      },
      {
        characterId: 'vrd_7d102c6a8fe5440a',
        slot: 3,
        profile: {
          firstName: 'Jonas',
          lastName: 'Berg',
          birthDate: '1988-11-02',
          gender: 'male',
          nationality: 'Norwegian',
        },
        job: {
          name: 'mechanic',
          label: 'Mechanic',
          grade: 2,
          onDuty: false,
        },
      },
    ],
    spawns: [
      {
        id: 'last',
        label: 'Last location',
        description: 'Continue where this character left off.',
      },
      {
        id: 'airport',
        label: 'Los Santos International',
        description: 'Arrive at the main terminal.',
      },
      {
        id: 'legion',
        label: 'Legion Square',
        description: 'Start in the heart of the city.',
      },
    ],
  });
  state.open = true;
  state.selectedCharacterId = state.characters[0].characterId;
  render();
}
