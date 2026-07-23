# varde_vehicles

Persistent, server-authoritative vehicle ownership for Varde Framework.

## Included

- Character ownership and shareable keys in SQLite.
- Server-created OneSync vehicles with stored/out lifecycle recovery.
- Replicated initialization state bags so the current entity owner applies
  plate, locks, and trusted properties after orphaned server creation.
- Qbox's familiar default public parking locations, represented in Varde's
  own JSON format and logic.
- Server-validated spawn, storage, lock, and trunk interactions.
- Per-vehicle trunk containers provided by `varde_inventory`.
- Trusted exports for dealerships, rewards, and admin resources.

No garage or dealership UI is bundled. The temporary `/garage`,
`/garage spawn <vehicle id>`, `/garage store`, `/trunk`, and `/vlock`
commands make the complete flow testable without an MLO.

The coordinate source and exact upstream revision are recorded in
[ATTRIBUTION.md](ATTRIBUTION.md).

For development, an ACE-authorized admin can use:

```text
/givevehicle <source> <model> [automobile|bike]
```

The bundled public garages accept land vehicles. Additional boat or aircraft
garages can opt into their matching `vehicleTypes` in `config/vehicles.json`.

## Server exports

```lua
local result = exports.varde_vehicles:RegisterOwnedVehicle(source, {
    model = 'sultan',
    vehicleType = 'automobile',
    garageId = 'pillboxgarage',
    properties = {}
})

local vehicles = exports.varde_vehicles:GetVehicles(source)
local hasKey = exports.varde_vehicles:HasKey(source, vehicleId)

exports.varde_vehicles:GiveKey(ownerSource, targetSource, vehicleId)
exports.varde_vehicles:RevokeKey(ownerSource, targetSource, vehicleId)
exports.varde_vehicles:SpawnVehicle(source, vehicleId, 'pillboxgarage')
```

Mutation exports return Varde's `{ ok, data, error }` envelope. Clients never
choose an owner, trunk container, world position, or stored vehicle state.
