# varde_core

`varde_core` is the first resource in the Varde Framework. It owns accounts,
characters, online sessions, money, the active-job snapshot, metadata, and last
known positions. Persistent job assignments are owned by `varde_jobs`.

It is not a fork and has no runtime dependency on another roleplay framework.

## Requirements

- FiveM for GTAV Enhanced and its Cfx Server artifact
- OneSync/state awareness enabled
- server-side Node 26 with the built-in `node:sqlite` module
- `sv_stateBagStrictMode true` is strongly recommended

The resource has no package-manager or database-server dependency.

## Start it

Place the resources under a server's `resources/[varde]` directory and add:

```cfg
# OneSync is built into Cfx Server for Enhanced. Do not set its read-only convar.
set sv_stateBagStrictMode true

ensure varde_core
ensure varde_jobs
ensure varde_example
```

For a local early-access test server, see the repository's
`server.cfg.example`.

The SQLite database is created automatically at `data/varde.sqlite`. The
database and its WAL files are ignored by Git.

## Configuration

Defaults live in `config/defaults.json`.

Two values currently have convar overrides:

```cfg
set varde_maxCharacters 4
set varde_saveIntervalMs 60000
```

Money is stored as non-negative integer game units. Floating-point balances are
rejected.

## Client exports

All high-level calls return this envelope:

```lua
{
    ok = true,
    data = ...
}
```

Failures return:

```lua
{
    ok = false,
    error = {
        code = 'ERROR_CODE',
        message = 'human-readable description'
    }
}
```

### Character and session API

```lua
local response = exports.varde_core:ListCharacters()
local response = exports.varde_core:GetCharacterBootstrap()

local response = exports.varde_core:CreateCharacter({
    slot = 1,
    firstName = 'Kari',
    lastName = 'Nordmann',
    birthDate = '1995-06-15',
    gender = 'unspecified',
    nationality = 'Norwegian'
})

local response = exports.varde_core:SelectCharacter('vrd_0123456789abcdef')
local response = exports.varde_core:DeleteCharacter('vrd_0123456789abcdef')
local response = exports.varde_core:Logout()

local playerData = exports.varde_core:GetPlayerData()
local loggedIn = exports.varde_core:IsLoggedIn()

-- Used by spawn/identity resources. The position must contain x, y, z, heading.
exports.varde_core:SpawnAt(position)
```

### Generic RPC API

```lua
local response = exports.varde_core:Call('characters:list', {})

exports.varde_core:CallAsync('characters:list', {}, function(response)
    if response.ok then
        print(json.encode(response.data))
    end
end)
```

The generic RPC only exposes methods registered by the core. It is not a route
to invoke arbitrary server functions.

## Server exports

An `identifier` can be an online server ID or an online `characterId`.

`GetPlayerData` returns a snapshot or `nil`:

```lua
local player = exports.varde_core:GetPlayerData(source)
local source = exports.varde_core:GetPlayerSource(characterId)
```

Characters can also be deleted from a trusted server resource while the owning
player is logged out:

```lua
local result = exports.varde_core:DeleteCharacter(
    source,
    characterId,
    characterId
)
```

Mutation exports return the same `ok/data/error` envelope used by client calls:

```lua
local result = exports.varde_core:AddMoney(
    source,
    'cash',
    250,
    'delivery_payment',
    'delivery:841'
)

local result = exports.varde_core:RemoveMoney(
    source,
    'bank',
    100,
    'invoice_payment',
    'invoice:95'
)

local result = exports.varde_core:SetMoney(
    source,
    'cash',
    500,
    'admin_correction',
    'ticket:12'
)

local result = exports.varde_core:SetMetadata(
    source,
    'licenses.driving',
    { granted = true, issuedAt = os.time() }
)

local result = exports.varde_core:SetJob(source, {
    name = 'police',
    label = 'Police',
    type = 'leo',
    grade = 1,
    gradeLabel = 'Officer',
    payment = 750,
    onDuty = false
})

local result = exports.varde_core:SavePlayer(source)
```

The invoking resource name is written to every money ledger entry. Resources
should supply a stable `reason` and `reference` so transactions are auditable.

## Client events

Other client resources can listen for:

```lua
AddEventHandler('varde:client:playerLoaded', function(playerData)
end)

AddEventHandler('varde:client:playerUpdated', function(playerData)
end)

AddEventHandler('varde:client:playerLoggedOut', function()
end)
```

`playerUpdated` currently fires after money, metadata, or job changes.

Server resources can listen for `varde:server:playerLoaded`,
`varde:server:playerLoggedOut`, `varde:server:playerDropped`,
`varde:server:characterDeleted`, and `varde:server:jobUpdated`. These are local
server events; clients cannot invoke them over the network.

## Player data

The owner-only snapshot has this shape:

```text
characterId
slot
profile
  firstName
  lastName
  birthDate
  gender
  nationality
job
  name
  label
  type
  grade
  gradeLabel
  payment
  onDuty
position
  x
  y
  z
  heading
money
  cash
  bank
metadata
createdAt
updatedAt
```

Only these public facts are replicated to other clients through state bags:

- `varde:loaded`
- `varde:characterId`
- `varde:job`

Balances, profile details, position, and metadata are never put into replicated
state bags.

## Security model

- The server owns all persistent state.
- A client may list, create, select, and log out only its own characters.
- Character deletion requires ownership, an exact confirmation value, and a
  logged-out session.
- Rockstar `license2` is preferred, with `license` as fallback.
- IP identifiers are not persisted.
- RPC envelopes and payload sizes are validated.
- Every core RPC method is rate-limited independently.
- Position updates are finite, world-bounded, and rate-limited.
- Money changes are only exposed as server exports.
- Wallet changes and ledger insertion occur in one SQLite transaction.
- Duplicate connections for the same Rockstar account are rejected.

`varde_example` contains an ACE-protected `/grantcash` command. Give trusted
administrators the `varde.admin` ACE if you want to use it.

## Local tests

From this directory:

```powershell
node --test
```

The tests cover validation, schema creation, persistence, character slots,
money rollback, ledger entries, duplicate account protection, and the complete
login lifecycle.

## Early-access integration checklist

Run these checks against the latest public Cfx Server artifact:

1. Confirm `node_version '26'` is accepted by the Enhanced resource loader.
2. Confirm Cfx Server's Node build exposes `node:sqlite`.
3. Connect, create a character, select it, reconnect, and verify persistence.
4. Restart `varde_core` while connected and verify a fresh character
   selection works.
5. Verify all three public state bags with strict mode enabled.
6. Record a Perfetto trace during repeated position sync and autosave.
7. Inspect the Enhanced Prometheus metrics for JS memory and event-loop depth.
