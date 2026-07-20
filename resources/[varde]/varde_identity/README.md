# varde_identity

Character selection, creation, deletion, and spawn choice for Varde Framework.
The resource uses plain HTML, CSS, and JavaScript and has no package-manager
dependencies.

## Start order

```cfg
ensure varde_core
ensure varde_identity
```

When `varde_identity` is running, `varde_core` delegates post-login spawning to
it. If the identity resource is absent, core falls back to the character's last
saved position.

## Configuration

Edit `config.lua` to change:

- title and subtitle
- whether character deletion is shown
- available spawn locations

Character ownership, slot limits, deletion confirmation, and selection remain
server-authoritative in `varde_core`.

## Browser preview

The web UI includes local preview data when it is opened outside FiveM. Serve
the `web` directory with any local static HTTP server to review responsive
layout and form interactions without a running game client.
