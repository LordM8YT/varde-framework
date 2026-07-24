'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LocaleService } = require('../server/locale');

const resourceRoot = path.resolve(__dirname, '..');

function readLocale(locale) {
  return JSON.parse(
    fs.readFileSync(path.join(resourceRoot, 'locales', `${locale}.json`), 'utf8'),
  );
}

function leafPaths(value, prefix = '', output = []) {
  for (const [key, entry] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      leafPaths(entry, current, output);
    } else {
      output.push(current);
    }
  }
  return output.sort();
}

function runtime() {
  return {
    loadResourceFile(relativePath) {
      const filename = path.join(resourceRoot, relativePath);
      return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
    },
  };
}

test('English and Norwegian locale catalogs have identical keys', () => {
  assert.deepEqual(leafPaths(readLocale('no')), leafPaths(readLocale('en')));
});

test('locale service selects Norwegian and interpolates replacements', () => {
  const locale = new LocaleService(runtime(), 'no', 'en');
  assert.equal(locale.locale, 'no');
  assert.equal(locale.get('identity.subtitle'), 'Velg din vei');
  assert.equal(
    locale.get('vehicles.created', {
      model: 'sultan',
      plate: 'VARDE',
      source: 7,
    }),
    'Opprettet sultan (VARDE) for kilde 7.',
  );
});

test('unknown regional locale falls back to its base or English', () => {
  const norwegian = new LocaleService(runtime(), 'no-NO', 'en');
  assert.equal(norwegian.locale, 'no');
  assert.equal(norwegian.get('common.unknown'), 'Ukjent');

  const french = new LocaleService(runtime(), 'fr-FR', 'en');
  assert.equal(french.locale, 'en');
  assert.equal(french.get('common.unknown'), 'Unknown');
});

test('missing key can use an explicit developer fallback', () => {
  const locale = new LocaleService(runtime(), 'en', 'en');
  assert.equal(
    locale.get('custom.missing', { value: 42 }, 'Value {{value}}'),
    'Value 42',
  );
});
