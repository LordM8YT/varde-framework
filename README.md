# Varde Framework

Varde is an independent, Enhanced-first roleplay framework for FiveM. It is built from
scratch and does not require Qbox, QBCore, ESX, ox_lib, or oxmysql.

The current pre-alpha foundation includes:

- account creation from the player's Cfx license
- multiple persistent characters
- responsive character selection, creation, deletion, and spawn UI
- server-authoritative sessions
- persistent cash and bank balances with an audit ledger
- jobs, metadata, and last position
- persistent hunger, thirst, stress, and a versioned HUD data provider
- server-authoritative inventory sessions, world drops, and UI contracts
- persistent vehicle ownership, keys, garages, locks, and trunks
- persistent freemode appearance reapplied after spawn
- shared English/Norwegian localization with English fallback
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
    varde_status/     Persistent needs and HUD telemetry
    varde_vehicles/   Ownership, keys, garages, and trunks
    varde_appearance/ Persistent freemode character appearance
    varde_admin/      ACE-secured operations and audit panel
    varde_phone/      Contacts and offline text messaging
    varde_example/    Commands showing the public API
templates/
  varde_resource/     Copyable starter for new Varde resources
server.cfg.example       Minimal development configuration
```

## Current status

This repository contains a testable pre-alpha for FiveM for GTAV Enhanced.
Automated tests cover each persistence and service layer; native-backed vehicle,
ped, NUI, and marker flows still require the manual Enhanced test plan before
an alpha tag.

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

External resources should begin with the
[Varde resource starter](templates/varde_resource). It demonstrates direct
exports, replicated State Bags, and native ACE-protected commands without
QBCore, Qbox, or ESX compatibility patterns.

Language is selected once in `server.cfg` with `setr varde_locale "en"` or
`setr varde_locale "no"`. See [Localization](docs/localization.md) for the
runtime API and instructions for adding another language.

The first public artifact should be validated with the
[Enhanced early-access test plan](docs/early-access-test-plan.md) before an
alpha release is tagged.

See [the core documentation](<resources/[varde]/varde_core/README.md>) for
installation, exports, events, and the security model.

Job definitions and the permission API are documented in
[varde_jobs](<resources/[varde]/varde_jobs/README.md>).

Item, container, and transfer APIs are documented in
[varde_inventory](<resources/[varde]/varde_inventory/README.md>).

Needs and HUD telemetry are documented in
[varde_status](<resources/[varde]/varde_status/README.md>).

Vehicle ownership, keys, garages, and trunks are documented in
[varde_vehicles](<resources/[varde]/varde_vehicles/README.md>).

Persistent character customization is documented in
[varde_appearance](<resources/[varde]/varde_appearance/README.md>).

Administration permissions and actions are documented in
[varde_admin](<resources/[varde]/varde_admin/README.md>).

The text-only communication MVP is documented in
[varde_phone](<resources/[varde]/varde_phone/README.md>).

Frontend contributors should use the versioned
[Varde UI contracts](docs/ui-contracts/v1/README.md) and bundled mock payloads.
NUI code never accesses a framework export or database directly.

## License

Varde Framework is available under the [MIT License](LICENSE).
