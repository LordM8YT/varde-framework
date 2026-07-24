# Contributing to Varde

Varde is an independent framework. Contributions may learn from public APIs and
general architecture elsewhere, but should not copy implementation code,
branding, UI assets, or database schemas from Qbox, QBCore, ESX, or another
project unless the source license, attribution, and reason are explicitly
documented.

## Development setup

Requirements:

- Node 24 or newer locally; Cfx Server uses Node 26
- Lua 5.4 compiler (`luac`) for syntax validation
- Git

Run every automated check from the repository root:

```powershell
npm test
git diff --check
```

No `npm install` is required. Runtime and test code use Node built-ins.

## Change design

- Give each domain one owning resource and database.
- Keep `varde_core` small; domain resources should consume its public API.
- Treat every client event and NUI callback as untrusted input.
- Do not put private player data in replicated state bags.
- Use result envelopes for fallible mutation exports.
- Bound text, numbers, metadata, payload size, and request rate.
- Write audit records for money, inventory, moderation, and other sensitive
  changes.
- Add a local server event cleanup path for character-owned data.

Public exports, events, config keys, and ACE permissions must be documented in
the owning resource's README.

## Database changes

Read
[Database and Backups](https://github.com/LordM8YT/varde-framework/wiki/Database-and-Backups)
before changing a schema.
Migrations are forward-only, transactional, resource-owned, and covered by
tests. Never edit an operator's database or `PRAGMA user_version` manually.

## Pull requests

Keep a pull request focused on one milestone. Include:

- why the change is needed
- security and ownership boundaries
- automated test results
- manual FiveM steps when native integration cannot run in unit tests
- screenshots for visible UI changes

The pull request template contains the required checklist. Review feedback
should be resolved with new commits; avoid force-pushing after review begins
unless history contains a secret.
