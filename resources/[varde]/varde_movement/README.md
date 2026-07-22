# varde_movement

`varde_movement` is Varde's optional Enhanced-first on-foot movement module. It
keeps the framework core free of gameplay policy while providing camera-facing
strafe, sprint sliding, and momentum-preserving low vaults.

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
- physics natives run only while sliding or vaulting
- first-person, free-aim, swimming, climbing, cover, and ragdoll states retain
  their normal game behavior
- the module never replaces the gameplay camera with a scripted camera

Dynamic sprint FOV is intentionally deferred. FiveM Enhanced does not currently
offer a reliable way for this module to change the gameplay-camera FOV without
replacing the follow camera, which can leave the camera behind the moving ped.

Displayed resmon values depend on the client, artifact, frame rate, and other
resources. No exact millisecond value can be guaranteed on every machine.
