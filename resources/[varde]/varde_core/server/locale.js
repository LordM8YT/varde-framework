'use strict';

function normalizeLocale(value, fallback = 'en') {
  const locale = String(value || fallback)
    .trim()
    .toLowerCase()
    .replaceAll('_', '-');
  if (!/^[a-z0-9-]{2,16}$/u.test(locale)) return fallback;
  return locale;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function merge(fallback, selected) {
  if (
    !fallback
    || typeof fallback !== 'object'
    || Array.isArray(fallback)
  ) {
    return selected === undefined ? clone(fallback) : clone(selected);
  }

  const output = {};
  const selectedObject =
    selected && typeof selected === 'object' && !Array.isArray(selected)
      ? selected
      : {};
  for (const key of new Set([
    ...Object.keys(fallback),
    ...Object.keys(selectedObject),
  ])) {
    output[key] = merge(fallback[key], selectedObject[key]);
  }
  return output;
}

function lookup(dictionary, key) {
  let current = dictionary;
  for (const part of String(key || '').split('.')) {
    if (
      !part
      || !current
      || typeof current !== 'object'
      || !Object.hasOwn(current, part)
    ) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function interpolate(value, replacements = {}) {
  return String(value).replace(/\{\{([A-Za-z0-9_]+)\}\}/gu, (match, key) => {
    const replacement = replacements?.[key];
    return replacement === undefined || replacement === null
      ? match
      : String(replacement);
  });
}

class LocaleService {
  constructor(runtime, selectedLocale = 'en', fallbackLocale = 'en') {
    this.runtime = runtime;
    this.fallbackLocale = normalizeLocale(fallbackLocale);
    this.requestedLocale = normalizeLocale(selectedLocale, this.fallbackLocale);
    this.fallback = this.loadRequired(this.fallbackLocale);
    const selected = this.loadSelected(this.requestedLocale);
    this.locale = selected.locale;
    this.translations = merge(this.fallback, selected.translations);
  }

  read(locale) {
    const raw = this.runtime.loadResourceFile(`locales/${locale}.json`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch (error) {
      throw new Error(`locales/${locale}.json is invalid: ${error.message}`);
    }
  }

  loadRequired(locale) {
    const translations = this.read(locale);
    if (!translations) {
      throw new Error(`required fallback locale locales/${locale}.json is missing`);
    }
    return translations;
  }

  loadSelected(locale) {
    const candidates = [locale];
    const base = locale.split('-')[0];
    if (base !== locale) candidates.push(base);
    if (!candidates.includes(this.fallbackLocale)) {
      candidates.push(this.fallbackLocale);
    }

    for (const candidate of candidates) {
      const translations = this.read(candidate);
      if (translations) return { locale: candidate, translations };
    }
    return { locale: this.fallbackLocale, translations: this.fallback };
  }

  get(key, replacements, fallback) {
    const value = lookup(this.translations, key);
    if (typeof value === 'string') return interpolate(value, replacements);
    if (fallback !== undefined && fallback !== null) {
      return interpolate(fallback, replacements);
    }
    return String(key || '');
  }

  getData(namespace) {
    const value = namespace ? lookup(this.translations, namespace) : this.translations;
    return value && typeof value === 'object' ? clone(value) : {};
  }
}

module.exports = {
  LocaleService,
  interpolate,
  lookup,
  merge,
  normalizeLocale,
};
