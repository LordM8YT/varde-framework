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
    varde_example/    Commands showing the public API
server.cfg.example       Minimal development configuration
```

## Current status

This repository contains an MVP intended for the FiveM for GTAV Enhanced early
access release. Unit tests run locally, but the resource still needs an
integration pass against the first public Cfx Server artifact.

See [the core documentation](<resources/[varde]/varde_core/README.md>) for
installation, exports, events, and the security model.

Job definitions and the permission API are documented in
[varde_jobs](<resources/[varde]/varde_jobs/README.md>).

## License

Varde Framework is available under the [MIT License](LICENSE).
