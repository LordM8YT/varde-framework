# varde_admin

`varde_admin` is an ACE-secured operations panel for Varde. Open it with
`/vadmin`. Every client request is re-authorized and validated on the server;
the NUI never has direct access to framework exports.

## Capabilities

- online Varde character list
- go to / bring
- freeze / unfreeze, heal, and kick
- set cash or bank balance
- assign configured jobs and grades
- give configured inventory items
- persistent success and failure audit records

The integrations call Varde's public server exports. `varde_jobs` or
`varde_inventory` can be stopped, but their respective actions will return an
explicit integration error.

## ACE permissions

`varde.admin` is the root permission and grants every panel capability.
Granular permissions are:

- `varde.admin.open`
- `varde.admin.players`
- `varde.admin.teleport`
- `varde.admin.moderation`
- `varde.admin.economy`
- `varde.admin.jobs`
- `varde.admin.inventory`
- `varde.admin.audit`

Example:

```cfg
add_ace group.admin varde.admin allow

# A support role with only player visibility and teleport:
add_ace group.support varde.admin.open allow
add_ace group.support varde.admin.players allow
add_ace group.support varde.admin.teleport allow
```

FiveM principals still need to be assigned to these groups in the server's
access-control configuration.

## Audit and privacy

Actions record actor and target source/character IDs, action name, outcome,
bounded action details, and timestamp in `data/admin.sqlite`. Free-form item
metadata is not copied into the admin audit. The default retention window is
180 days and old records are pruned when the resource starts.
