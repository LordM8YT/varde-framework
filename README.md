# Varde Framework

Varde is an independent, Enhanced-first roleplay framework for FiveM. It is built from
scratch and does not require Qbox, QBCore, ESX, ox_lib, or oxmysql.

The first milestone is intentionally small:

- account creation from the player's Cfx license
- multiple persistent characters
- responsive character selection, creation, deletion, and spawn UI
- server-authoritative sessions
- persistent cash and bank balances with an audit ledger
- jobs, metadata, and last position
- a rate-limited client/server RPC layer
- explicit, minimal state bag replication
- a public export API for resources built on top of the framework

The server core uses the `node:sqlite` module bundled with Node 26 in Cfx
Server. Client gameplay code uses Lua 5.4.

## Repository layout

```text
resources/
  [varde]/
    varde_core/       Framework core
    varde_identity/   Character and spawn UI
    varde_jobs/       Jobs, grades, duty, and permissions
    varde_inventory/  Server-authoritative items and containers
    varde_admin/      ACE-secured operations and audit panel
    varde_phone/      Contacts and offline text messaging
    varde_example/    Commands showing the public API
server.cfg.example       Minimal development configuration
```

## Current status

This repository contains an MVP intended for the FiveM for GTAV Enhanced early
access release. Unit tests run locally, but the resource still needs an
integration pass against the first public Cfx Server artifact.

## Install with txAdmin

Choose **Remote URL Template** during txAdmin setup and paste:

```text
https://raw.githubusercontent.com/LordM8YT/varde-framework/main/recipe.yaml
```

The recipe creates a complete server-data directory with the standard CFX
resources, Varde, a generated `server.cfg`, and no external framework or
database dependency. See the [txAdmin installation guide](docs/txadmin-install.md)
for the full setup flow and the Enhanced early-access note.

## Development

Run all Node tests, web-script checks, and Lua syntax checks from the repository
root:

```powershell
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for design and review rules,
[SECURITY.md](SECURITY.md) for private reporting, and
[Database lifecycle](docs/database-lifecycle.md) for backup and migration
procedures.

The first public artifact should be validated with the
[Enhanced early-access test plan](docs/early-access-test-plan.md) before an
alpha release is tagged.

See [the core documentation](<resources/[varde]/varde_core/README.md>) for
installation, exports, events, and the security model.

Job definitions and the permission API are documented in
[varde_jobs](<resources/[varde]/varde_jobs/README.md>).

Item, container, and transfer APIs are documented in
[varde_inventory](<resources/[varde]/varde_inventory/README.md>).

Administration permissions and actions are documented in
[varde_admin](<resources/[varde]/varde_admin/README.md>).

The text-only communication MVP is documented in
[varde_phone](<resources/[varde]/varde_phone/README.md>).

## License

Varde Framework is available under the [MIT License](LICENSE).
