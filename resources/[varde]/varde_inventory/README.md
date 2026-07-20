# varde_inventory

`varde_inventory` is Varde's server-authoritative item layer. It stores player
inventories and registered stashes in its own SQLite database. The first
version intentionally exposes stable primitives instead of coupling the data
model to one inventory UI.

## Model

- Slot and weight limits are enforced on the server.
- Stack identity includes canonical item metadata.
- Item moves, removals, transfers, and audit entries use SQLite transactions.
- Clients can move and use only items in their own inventory.
- Adding, removing, transferring, and registering stashes are server exports.
- Inventory contents are sent only to their owner and are not replicated in
  public state bags.

Configure item labels, gram weights, and stack limits in `config/items.json`.

## Server exports

Read exports return data directly:

```lua
local inventory = exports.varde_inventory:GetInventory(source)
local count = exports.varde_inventory:GetItemCount(source, 'water')
local hasItem = exports.varde_inventory:HasItem(source, 'radio', 1)
local canCarry = exports.varde_inventory:CanCarryItem(source, 'water', 2)
```

Mutation exports return `{ ok, data, error }` envelopes:

```lua
exports.varde_inventory:AddItem(source, 'water', 2, {
    quality = 100
})

exports.varde_inventory:RemoveItem(source, 'water', 1)
exports.varde_inventory:MoveItem(source, 1, 8, 1)
exports.varde_inventory:TransferItem(source, targetSource, 1, 1)

exports.varde_inventory:RegisterStash(
    'police_evidence',
    'Police Evidence',
    100,
    500000
)
```

The same APIs accept a character ID or a full container ID such as
`stash:police_evidence`. Player sources must be online; character and container
IDs also support trusted offline mutations.

## Usable items

A server resource can register a synchronous handler:

```js
exports.varde_inventory.RegisterUsableItem('bandage', (source, item) => {
  // Validate and apply the effect.
  return { consume: 1 };
});
```

Returning `false` rejects use. Returning `true` consumes one. Returning an
object with `consume` controls the amount. Asynchronous handlers are rejected
so a client cannot queue overlapping uses while a handler is suspended.

## Client API

`GetInventory`, `GetItemCount`, and `HasItem` read the owner-only cache. The
`varde_inventory:client:updated` local event fires after every server update.

Temporary text commands are included for early-access testing:
`/inventory`, `/invslot <from> <to> [amount]`, and `/useitem <slot>`.
