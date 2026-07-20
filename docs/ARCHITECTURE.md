# Architecture

## Direction

Varde Framework is an independent core with optional integrations at its
edges. Compatibility adapters may be added later, but framework-specific
objects, tables, global variables, and event names must not enter the core.

The main design rule is ownership: the resource that owns data is the only
resource that mutates it. Consumers use documented exports and events.

## Runtime split

```text
Client Lua
  commands/UI/resources
       |
       | rate-limited RPC and owner-only snapshots
       v
varde_core (Node 26)
  validation -> session service -> SQLite repository
       |                            |
       | explicit public state      | atomic wallets + ledger
       v                            v
  replicated state bags       varde.sqlite
```

Lua is used for client-native interaction. Node 26 is used for the server core
because Enhanced ships it directly and its built-in SQLite driver gives the
framework durable storage without a separate database resource.

## Boundaries

### Database

The repository owns migrations and all SQL. Other resources must not query the
framework tables directly.

### Service

The service owns connected accounts and active character sessions. It accepts
validated commands, updates persistent data, and emits owner snapshots.

### RPC

The RPC layer is a small transport boundary. It validates request envelopes,
limits payload size, applies a per-method rate limit, and maps expected errors
to stable codes.

### Public state

State bags are a discovery mechanism, not a player database. Only facts needed
by nearby resources are replicated. Private data remains in the server process
or is sent directly to its owning client.

## Next milestones

1. Release-day compatibility pass against Cfx Server.
2. Character selector and appearance resources.
3. Registries for jobs, items, and permissions.
4. Inventory as a separate resource with its own persistence boundary.
5. Vehicle ownership and server-created persistent entities.
6. Optional compatibility adapters maintained outside `varde_core`.
