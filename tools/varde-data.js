#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');

const MANIFEST_VERSION = 1;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeRelative(root, filename) {
  const relative = path.relative(root, filename);
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`unsafe path outside repository root: ${filename}`);
  }
  return relative.split(path.sep).join('/');
}

function resolveManifestPath(root, relative) {
  const normalized = String(relative || '').replaceAll('/', path.sep);
  const resolved = path.resolve(root, normalized);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw new Error(`unsafe path in backup manifest: ${relative}`);
  }
  return resolved;
}

function databaseFiles(root) {
  const resourceRoot = path.join(root, 'resources', '[varde]');
  if (!fs.existsSync(resourceRoot)) {
    return [];
  }
  const files = [];
  for (const resource of fs.readdirSync(resourceRoot, { withFileTypes: true })) {
    if (!resource.isDirectory()) {
      continue;
    }
    const dataDirectory = path.join(resourceRoot, resource.name, 'data');
    if (!fs.existsSync(dataDirectory)) {
      continue;
    }
    for (const entry of fs.readdirSync(dataDirectory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.sqlite')) {
        files.push(path.join(dataDirectory, entry.name));
      }
    }
  }
  return files.sort();
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function inspectDatabase(filename) {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    const integrityRow = database.prepare('PRAGMA integrity_check').get();
    const integrity = String(Object.values(integrityRow)[0]);
    const version = Number(
      database.prepare('PRAGMA user_version').get().user_version,
    );
    return {
      integrity,
      schemaVersion: version,
      size: fs.statSync(filename).size,
    };
  } finally {
    database.close();
  }
}

async function backupDatabaseSet(root, destination) {
  const repositoryRoot = path.resolve(root);
  const output = path.resolve(destination);
  const files = databaseFiles(repositoryRoot);
  if (files.length === 0) {
    throw new Error('no Varde SQLite databases were found');
  }
  if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
    throw new Error(`backup destination is not empty: ${output}`);
  }
  fs.mkdirSync(output, { recursive: true });

  const entries = [];
  for (const source of files) {
    const sourceRelative = safeRelative(repositoryRoot, source);
    const targetRelative = sourceRelative;
    const target = resolveManifestPath(output, targetRelative);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const database = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(database, target);
    } finally {
      database.close();
    }

    const inspection = inspectDatabase(target);
    if (inspection.integrity !== 'ok') {
      throw new Error(`backup integrity failed for ${sourceRelative}`);
    }
    entries.push({
      source: sourceRelative,
      file: targetRelative,
      sha256: sha256(target),
      size: inspection.size,
      schemaVersion: inspection.schemaVersion,
    });
  }

  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    databases: entries,
  };
  fs.writeFileSync(
    path.join(output, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  return manifest;
}

function verifyBackup(directory) {
  const root = path.resolve(directory);
  const manifestFile = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(
      `unsupported backup manifest version ${manifest.manifestVersion}`,
    );
  }
  if (!Array.isArray(manifest.databases) || manifest.databases.length === 0) {
    throw new Error('backup manifest contains no databases');
  }

  const results = [];
  for (const entry of manifest.databases) {
    const filename = resolveManifestPath(root, entry.file);
    if (!fs.existsSync(filename)) {
      throw new Error(`backup file is missing: ${entry.file}`);
    }
    if (sha256(filename) !== entry.sha256) {
      throw new Error(`backup checksum failed: ${entry.file}`);
    }
    const inspection = inspectDatabase(filename);
    if (inspection.integrity !== 'ok') {
      throw new Error(`backup integrity failed: ${entry.file}`);
    }
    if (inspection.schemaVersion !== Number(entry.schemaVersion)) {
      throw new Error(`backup schema version changed: ${entry.file}`);
    }
    results.push({ file: entry.file, ...inspection });
  }
  return results;
}

function inspectLiveDatabases(root) {
  return databaseFiles(path.resolve(root)).map((filename) => ({
    file: safeRelative(path.resolve(root), filename),
    ...inspectDatabase(filename),
  }));
}

async function main(argv = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..');
  const command = argv[0];
  if (command === 'backup') {
    const destination = path.resolve(
      argv[1] || path.join(root, 'backups', timestamp()),
    );
    const manifest = await backupDatabaseSet(root, destination);
    console.log(
      `Backed up ${manifest.databases.length} database(s) to ${destination}`,
    );
    return;
  }
  if (command === 'verify') {
    if (!argv[1]) {
      throw new Error('usage: node tools/varde-data.js verify <backup-directory>');
    }
    const results = verifyBackup(argv[1]);
    for (const result of results) {
      console.log(
        `${result.file}: integrity=${result.integrity} schema=${result.schemaVersion}`,
      );
    }
    return;
  }
  if (command === 'inspect') {
    const results = inspectLiveDatabases(root);
    if (results.length === 0) {
      console.log('No live Varde SQLite databases found.');
    }
    for (const result of results) {
      console.log(
        `${result.file}: integrity=${result.integrity} schema=${result.schemaVersion} size=${result.size}`,
      );
    }
    return;
  }
  throw new Error(
    'usage: node tools/varde-data.js <backup [directory] | verify <directory> | inspect>',
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[varde-data] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  backupDatabaseSet,
  databaseFiles,
  inspectDatabase,
  inspectLiveDatabases,
  verifyBackup,
};
