# Database lifecycle

Each Varde domain owns one SQLite file under its resource's `data` directory.
No resource writes another resource's tables.

| Resource | Default database | Owner |
| --- | --- | --- |
| `varde_core` | `data/varde.sqlite` | accounts, characters, money |
| `varde_jobs` | `data/jobs.sqlite` | job assignments and audit |
| `varde_inventory` | `data/inventory.sqlite` | containers, items, audit |
| `varde_status` | `data/status.sqlite` | hunger, thirst, stress |
| `varde_vehicles` | `data/vehicles.sqlite` | owned vehicles and keys |
| `varde_appearance` | `data/appearance.sqlite` | freemode appearance |
| `varde_admin` | `data/admin.sqlite` | admin audit |
| `varde_phone` | `data/phone.sqlite` | numbers, contacts, messages |

Runtime database files and backups are ignored by Git.

## Back up

The backup command uses Node's SQLite backup API, so each copied database is a
consistent snapshot even when WAL mode is enabled:

```powershell
npm run data:backup
```

The default destination is `backups/<UTC timestamp>`. To choose one:

```powershell
node tools/varde-data.js backup D:\varde-backups\before-update
```

Every backup includes `manifest.json` with relative source paths, SHA-256
checksums, sizes, and schema versions. Store copies outside the game server.

Verify before relying on a backup:

```powershell
node tools/varde-data.js verify D:\varde-backups\before-update
```

Verification checks the manifest, checksum, SQLite integrity, and schema
version of every file. Inspect live databases with:

```powershell
npm run data:inspect
```

## Restore

Restoration is deliberately manual:

1. Stop Cfx Server and confirm no Varde/Node process is using the files.
2. Verify the selected backup.
3. Make a second copy of the current `data` directories.
4. Copy every database in the backup to the `source` path recorded in
   `manifest.json`.
5. Remove stale `-wal` and `-shm` sidecars only while the server is stopped.
6. Start the server and inspect migration output.
7. Run `npm run data:inspect` and complete the resource integration checklist.

Restore the complete backup set. Mixing databases from different timestamps
can leave cross-resource character IDs out of sync.

## Migration rules

Schemas use `PRAGMA user_version`. Resource startup must:

1. read the current version
2. refuse to start if the database is newer than the code supports
3. run each missing migration in order inside `BEGIN IMMEDIATE`
4. update `user_version` only after the migration succeeds
5. roll back the whole migration on error

Migrations are forward-only. A pull request that changes a schema must include:

- upgrade code from every supported prior version
- a test that creates the prior schema and verifies preserved data
- updated schema documentation
- an operator note when the migration may take noticeable time

Never change an existing migration after it has reached `main`. Add the next
version instead.
