# Security policy

## Supported versions

Varde is pre-1.0. Security fixes are applied to the latest `main` branch.
There are currently no supported historical release branches.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/LordM8YT/varde-framework/security/advisories/new).

Include:

- affected commit or release
- resource and public API involved
- impact and realistic attack path
- minimal reproduction
- suggested mitigation, if known

Remove real license keys, access tokens, Rockstar/Cfx identifiers, IP
addresses, and production database contents. A maintainer will acknowledge a
complete report when available, reproduce it privately, and coordinate a fix
before public disclosure.

## Operator security

- Keep `sv_licenseKey`, database backups, txAdmin data, and access-control
  configuration outside the repository.
- Grant `varde.admin` and `varde.jobs.manage` only to trusted principals.
- Do not expose resource data directories through a web server.
- Back up and verify all SQLite databases before updating framework code.
- Stop the server before restoring files.
- Treat third-party resources as trusted server code: server exports can mutate
  player state and persistent data.

Varde cannot protect a server from arbitrary code installed as another
server-side resource.
