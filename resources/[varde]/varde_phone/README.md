# varde_phone

`varde_phone` is the text-only communication MVP for Varde. It owns phone
numbers, contacts, SMS-style conversations, unread state, and read receipts in
its own SQLite database.

Voice calls are intentionally not implemented. They should be added only after
the FiveM Enhanced voice API and server integration have been tested against a
public artifact.

## Use

Open or close the phone with `F1` or `/phone`.

The default configuration does not require an inventory item, which keeps the
early-access test flow usable. To require the configured `phone` item:

```json
{
  "requirePhoneItem": true,
  "phoneItem": "phone"
}
```

The check is performed on the server through `varde_inventory`. A stopped
inventory resource produces an explicit integration error when hardware is
required.

## Behavior

- Each character receives one stable, unique number.
- Messages are persisted for offline recipients.
- Sender identity is derived from the authenticated character session.
- Client nonces make retried sends idempotent.
- Contact and message input is length-bounded and rate-limited.
- Opening a conversation marks incoming messages as read.
- Deleting a character removes its number, contacts, and conversations.
- Phone contents are owner-only and never replicated through public state bags.

The number prefix and length are fixed when the database begins receiving
accounts. Changing them later affects new numbers only; treat that as a schema
and product migration.

## Server exports

```lua
local number = exports.varde_phone:GetPhoneNumber(source)

local result = exports.varde_phone:SendMessage(
    source,
    recipientNumber,
    'Your vehicle is ready.'
)
```

`GetPhoneNumber` returns a string or `nil`. `SendMessage` returns the standard
`{ ok, data, error }` result envelope and supports an online source or a Varde
character ID as sender. This makes service notifications possible even when
the sending character is not online.

## Client events

The phone UI consumes owner-only network events:

- `varde_phone:client:newMessage`
- `varde_phone:client:messagesRead`
- `varde_phone:client:contactsUpdated`

Other resources should prefer the server exports instead of emitting these
events themselves.
