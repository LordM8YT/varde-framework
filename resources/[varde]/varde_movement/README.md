# varde_movement

`varde_movement` is Varde's optional Enhanced-first on-foot movement module. It
keeps the framework core free of gameplay policy while providing camera-facing
strafe, speed FOV, sprint sliding, and momentum-preserving low vaults.

The module has no external dependencies. It activates only after
`varde:client:playerLoaded` and restores every ped flag it changes when the ped
or resource is replaced.

## Enable or disable

The txAdmin recipe enables the resource and its replicated convar by default:

```cfg
setr varde_movement_enabled true
ensure varde_movement
```

Set the convar to `false` and restart the resource to disable all movement
overrides without editing the resource.

## Runtime behavior

- non-playable, vehicle, dead, and loading states sleep for 500 ms
- the frame loop runs only for a loaded character that is alive and on foot
- expensive camera and physics natives run only while sprinting, sliding, or
  vaulting
- first-person, free-aim, swimming, climbing, cover, and ragdoll states retain
  their normal game behavior
- scripted FOV never intentionally replaces a camera owned by another resource

Displayed resmon values depend on the client, artifact, frame rate, and other
resources. No exact millisecond value can be guaranteed on every machine.
