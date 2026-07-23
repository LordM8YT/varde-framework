# Enhanced early-access test plan

Use this checklist for Varde's first run against a public FiveM for GTAV
Enhanced Cfx Server artifact. Record the exact artifact/build before testing.

## 1. Prepare

1. Pull the latest `main`.
2. Run `npm test` in the repository root.
3. Copy `server.cfg.example` outside the repository.
4. Add a real `sv_licenseKey` only to that external copy.
5. Add the test administrator's license principal:

   ```cfg
   add_principal identifier.license:REPLACE_ME group.admin
   add_ace group.admin varde.admin allow
   add_ace group.admin varde.jobs.manage allow
   add_ace group.admin varde.vehicles.manage allow
   ```

6. Keep the resource order from the example configuration.
7. Start with a new, empty set of `resources/[varde]/*/data` directories.

Never attach a real license key, access-control file, identifier, IP address, or
production database to a public issue.

## 2. Boot gate

The server must:

- accept `node_version '26'`
- load `node:sqlite`
- start every Varde resource without a stack trace
- create one SQLite database per owning resource
- enable OneSync and strict state bags

Run `npm run data:inspect` after the first clean shutdown. Every database should
report `integrity=ok` and its expected schema version.

Stop here if a resource fails to start. Capture the first error, not the cascade
of dependency errors that follows it.

## 3. Identity and persistence

With player A:

1. Connect and confirm the character selector appears.
2. Create two characters in different slots.
3. Select one and spawn at each available spawn option.
4. Move, disconnect, reconnect, and verify the saved position.
5. Log out and select the second character.
6. Delete the second character with the exact confirmation flow.
7. Confirm the deleted character does not return after a resource and server
   restart.

Verify that another client cannot select or delete player A's character ID.

## 4. Jobs without MLOs

From the server console or an ACE-authorized player:

```text
assignjob <source> police 1
assignjob <source> ambulance 1
assignjob <source> mechanic 1
```

Test the exterior duty markers:

| Job | Location | Coordinates |
| --- | --- | --- |
| Police | Mission Row | `441.13, -981.94, 30.69` |
| EMS | Pillbox Medical | `299.67, -584.38, 43.26` |
| Mechanic | La Mesa Customs | `731.29, -1088.95, 22.17` |

For each assigned job:

1. Confirm its blip and marker appear without an MLO or target resource.
2. Press `E` at the point to clock in and out.
3. Confirm `/jobs` shows active job, grade, and duty state.
4. Attempt the same duty event away from the point and confirm the server
   rejects it.
5. Disconnect while on duty and confirm duty is cleared.

## 5. Inventory

Use `/vadmin` to give the player `water`, `bandage`, and `phone`.

1. Confirm `/inventory` reports slots and weight.
2. Move full and partial stacks with `/invslot`.
3. Fill a stack and confirm its configured maximum is enforced.
4. Fill weight or slots and confirm the rejected add changes nothing.
5. Transfer items between two players through a small trusted test resource.
6. Register a stash and verify atomic player-to-stash transfer.
7. Restart the server and confirm items and metadata persist.

8. Drop a partial stack with `/dropitem`, open the marker with `E`, take the
   item back with `/takeitem`, and confirm the empty drop disappears for both
   clients.
9. Enable a development inventory frontend only after verifying it uses
   `varde.inventory.bootstrap.v1` and the `player`/`secondary` sides.

Inventory retains a text fallback while `config/ui.json` has `enabled: false`.
The drag-and-drop frontend can be developed without changing the server model.

## 6. Status and HUD contract

1. Connect with a new character and inspect the initial hunger, thirst, and
   stress values through `exports.varde_status:GetStatus()`.
2. Wait through at least two configured decay intervals.
3. Restart the resource and server and confirm the latest values persist.
4. Confirm the local `varde_status:client:hudUpdated` event matches
   `varde.hud.bootstrap.v1` and includes health, armor, stamina, money, and
   vehicle telemetry without a visual HUD installed.
5. Confirm status updates are sent only to their owning client.

## 7. Vehicles and garages

From the console or an ACE-authorized player:

```text
givevehicle <source> sultan automobile
```

1. Use `/garage` at one of the configured public parking locations.
2. Spawn with `/garage spawn <vehicle id>` and confirm the entity is created
   server-side with the persisted plate.
3. Lock and unlock with `L` or `/vlock`.
4. Open the trunk with `/trunk`, move an item into it, and restart the server.
5. Store the vehicle with `/garage store` while driving through the green
   marker, then spawn it again and confirm fuel and health persist.
6. Attempt spawn, store, lock, and trunk events remotely or without a key and
   confirm the server rejects each action.
7. Share and revoke a key through a trusted test resource and confirm the
   target's accessible vehicle list updates.

The default JSON uses the familiar Qbox public parking coordinates, but the
garage service, database, entities, validation, and inventory integration are
Varde-owned.

## 8. Appearance

1. Create one male and one female character and confirm the matching freemode
   model is applied after spawn.
2. Save components, props, head blend, overlays, hair, and eye values through a
   trusted test/editor resource.
3. Respawn and restart the server; confirm the same appearance is reapplied.
4. Submit an unallowed model, duplicate component, and out-of-range value and
   confirm each save is rejected.
5. Run `/resetappearance` and confirm the gender-based default returns.

## 9. Admin

With an authorized player:

1. Open `/vadmin`.
2. Select player B and test go to, bring, freeze/unfreeze, and heal.
3. Set cash and bank balances.
4. Assign a configured job and give a configured item.
5. Open the audit screen and confirm success records.
6. Intentionally submit one invalid job or item and confirm a failure record.

With an unauthorized player, confirm `/vadmin` does not expose the roster.
Then grant only `varde.admin.open` and confirm it still does not expose the
roster without `varde.admin.players`.

## 10. Text phone

The phone does not require an inventory item by default. Open it with `F1` or
`/phone`.

With players A and B:

1. Record both assigned phone numbers.
2. Add each number as a contact.
3. Exchange texts and verify sender names, order, unread counts, and read state.
4. Retry the same low-level send nonce and confirm only one message is stored.
5. Disconnect player B, send another text, reconnect B, and verify offline
   delivery.
6. Restart the server and verify numbers, contacts, and messages persist.

Voice calling is intentionally outside this milestone.

## 11. Restart and data gate

1. Run `npm run data:backup` while the server is online.
2. Verify the generated backup with `node tools/varde-data.js verify <path>`.
3. Restart each Varde resource individually.
4. Restart the complete server.
5. Re-run `npm run data:inspect`.
6. Confirm characters, money, jobs, duty state, inventory, status, vehicles,
   appearance, audit records, phone numbers, contacts, and messages have the
   expected persisted state.

Do not test restoration until the Cfx Server process is fully stopped. Follow
[Database lifecycle](database-lifecycle.md).

## 12. Performance and diagnostics

With at least two clients:

- watch server event-loop delay and JS memory metrics
- record a Perfetto trace during character selection and repeated inventory
  moves
- leave clients connected through multiple autosave intervals
- inspect database WAL growth after normal checkpoints and shutdown
- confirm position sync does not flood logs or the network

## Go / no-go

Varde is ready for an alpha tag only when:

- all root tests and GitHub Actions pass
- every resource boots on the public Enhanced artifact
- identity persistence survives a complete restart
- client-triggered mutations fail when ownership, permission, distance, amount,
  weight, or rate validation is violated
- backups verify successfully
- there are no known data-loss or privilege-escalation bugs

Cosmetic issues can become GitHub bugs. Data corruption, remote crashes,
identifier leaks, money/item duplication, or permission bypasses are no-go
issues.
