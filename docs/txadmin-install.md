# Install with txAdmin

Varde can be installed as a complete server-data directory with txAdmin's
Remote URL Template option. No MySQL server or other FiveM framework is
required.

## Recipe URL

```text
https://raw.githubusercontent.com/LordM8YT/varde-framework/main/recipe.yaml
```

## Fresh server

1. Start `cfx-server.exe` without a `+exec server.cfg` argument and finish the
   initial txAdmin account setup.
2. Select **Remote URL Template** as the deployment type.
3. Paste the recipe URL above, choose an empty data directory, and open the
   Recipe Deployer.
4. Review the recipe, enter the Cfx.re server key, and run it.
5. When deployment finishes, review `server.cfg`, then select **Save & Run
   Server**.

The recipe installs the standard CFX resources, every Varde resource, the MIT
license, and a ready-to-run `server.cfg`. txAdmin fills in the endpoints,
maximum player count, server key, server name, and the first administrator.
That administrator receives `varde.admin`, `varde.jobs.manage`, and
`varde.vehicles.manage` through the standard `group.admin` ACE group.

## Early-access note

The generated config enables `sv_devMode` for Enhanced early-access developer
tools. Disable it for production servers that do not need client developer
tooling. OneSync is enabled by the recipe and managed by txAdmin, so the
generated `server.cfg` does not duplicate that setting.

Varde intentionally does not set `sv_enforceGameBuild`. Enhanced supports the
latest gamebuild by default; setting it to `1` would instead load the base game
without DLC. Varde stores framework data in SQLite rather than the Cfx key-value
database, so no KVP migration is required. Its public player state bags are
replicated explicitly.

See Cfx's [Legacy vs Enhanced migration guide](https://docs.fivem.net/docs/developers/legacy-vs-enhanced/)
for the current breaking changes and compatibility variables.

The recipe tracks Varde's `main` branch while the framework is pre-alpha. Once
versioned releases exist, the recipe should be changed to install a pinned
release so that repeat deployments are reproducible.
