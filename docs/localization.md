# Localization

Varde uses one shared locale catalog for its Node server code, Lua clients, and
NUI. English is the default and fallback language. Norwegian is bundled.

## Select a language

Add one of these lines above every `ensure varde_*` entry in `server.cfg`:

```cfg
# English
setr varde_locale "en"

# Norwegian
setr varde_locale "no"
```

`setr` is required because the selected language must be visible to both the
server and clients. Restart the Varde resources, preferably the server, after
changing it.

An optional fallback can be configured:

```cfg
setr varde_fallbackLocale "en"
```

If a selected catalog or key is missing, Varde uses the matching English value.
Regional names fall back to their base language, so `no-NO` loads `no` when
`no-NO.json` does not exist.

## Use translations in a resource

The locale export is available on both sides:

```lua
local text = exports.varde_core:Locale('jobs.noJobs')

local message = exports.varde_core:Locale(
    'vehicles.created',
    {
        model = 'sultan',
        plate = 'VARDE',
        source = 7
    },
    'Created {{model}} ({{plate}}) for source {{source}}.'
)
```

Placeholders use `{{name}}`. Keep placeholder names identical in every
translation.

Client resources that feed a NUI can retrieve a safe copy of a namespace:

```lua
local translations = exports.varde_core:GetLocaleData('identity')
local localeName = exports.varde_core:GetLocale()
```

Server-side JavaScript resources use the same exports:

```js
const text = globalThis.exports.varde_core.Locale(
  'inventory.opened',
  { label: 'Evidence' },
  'Opened: {{label}}',
);
```

Internal identifiers remain language-independent. Job names such as `police`,
item names such as `water`, error codes, event names, and database values must
not be translated. Translate their labels only.

## Add a language

1. Copy `resources/[varde]/varde_core/locales/en.json`.
2. Name the copy with a short locale code, for example `fr.json`.
3. Translate values only. Do not rename, add, or remove keys.
4. Preserve every `{{placeholder}}`.
5. Save the file as UTF-8 JSON.
6. Set `setr varde_locale "fr"` and restart the server.
7. Run `npm test` from the repository root.

The locale test compares the complete key structure with English. A pull
request fails if a bundled translation is missing a key.
