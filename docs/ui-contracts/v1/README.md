# Varde UI contracts v1

These contracts are the stable boundary between Varde resources and their NUI
frontends. A frontend may be replaced without changing the owning service, and
the owning service may be refactored without changing these payloads.

## Rules

- Every bootstrap payload contains a `contract` field ending in `.v1`.
- NUI never calls framework exports or a database directly.
- Client input is untrusted. The owning server resource validates every
  mutation and returns the standard result envelope.
- Private owner data is sent only to its owning client.
- Additive fields may be introduced in v1. Removing or changing a field
  requires a new contract version.
- Full NUI bootstrap messages may include `localeName` and a namespaced
  `locale` dictionary beside the contract payload. Locale data is presentation
  metadata and is not trusted by server mutations.
- Timestamps are UTC ISO 8601 strings.
- Weights are integer grams and money values are integer account units.

## Standard result envelope

Successful NUI callbacks return:

```json
{
  "ok": true,
  "data": {}
}
```

Expected failures return:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A safe message for the player."
  }
}
```

Frontends must branch on `ok` and must not parse human-readable messages to
identify an error.

## HUD

Mock: [`hud.bootstrap.json`](hud.bootstrap.json)

The HUD receives window messages:

| `type` | Payload |
| --- | --- |
| `varde:hud:bootstrap` | Complete HUD bootstrap payload |
| `varde:hud:player` | `player` object from the bootstrap |
| `varde:hud:status` | `status` object from the bootstrap |
| `varde:hud:vehicle` | `vehicle` object or `null` |
| `varde:hud:visibility` | Partial `visibility` object |
| `varde:hud:close` | No payload |

Health and armor are observed from the local game ped. Persistent needs are
owned by `varde_status`; money and job data are owned by `varde_core`.

## Inventory

Mock: [`inventory.bootstrap.json`](inventory.bootstrap.json)

The inventory uses the NUI endpoint `inventoryRequest`:

| Method | Payload |
| --- | --- |
| `bootstrap` | `{}` |
| `move` | `{ "from": "player", "to": "player", "fromSlot": 1, "toSlot": 8, "amount": 1 }` |
| `split` | `{ "side": "player", "fromSlot": 1, "toSlot": 8, "amount": 1 }` |
| `use` | `{ "slot": 1 }` |
| `drop` | `{ "slot": 1, "amount": 1 }` |
| `transfer` | Same fields as `move`, with different `from` and `to` sides |
| `close` | `{}` |

The only accepted sides are `player` and `secondary`. The server resolves those
names through the active inventory session; clients never submit container IDs.

Window messages use `varde:inventory:open`, `varde:inventory:update`,
`varde:inventory:error`, and `varde:inventory:close`.

## Phone

Mock: [`phone.bootstrap.json`](phone.bootstrap.json)

The existing NUI endpoint is `phoneRequest`. Stable methods are:

- `bootstrap`
- `contacts:create`
- `contacts:update`
- `contacts:delete`
- `messages:list`
- `messages:send`

Window messages use `open`, `bootstrap`, `newMessage`, `messagesRead`, and
`close`. Voice calls and additional apps will receive separate versioned
contracts instead of changing the text contract.

## Local frontend development

The JSON files in this directory are safe mock fixtures. Frontends should offer
a browser development mode that loads them when `GetParentResourceName` is not
available. Production builds must use relative asset URLs and must not contain
real player data, server addresses, secrets, or remote development endpoints.
