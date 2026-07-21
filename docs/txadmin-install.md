# Install with txAdmin

Varde can be installed as a complete server-data directory with txAdmin's
Remote URL Template option. No MySQL server or other FiveM framework is
required.

## Recipe URL

```text
https://raw.githubusercontent.com/LordM8YT/varde-framework/main/recipe.yaml
```

## Fresh server

1. Start `FXServer.exe` without a `+exec server.cfg` argument and finish the
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
That administrator receives both `varde.admin` and `varde.jobs.manage` through
the standard `group.admin` ACE group.

## Early-access note

The generated config currently enables `sv_devmode` for Enhanced early-access
testing. This mode can limit the server to eight players. Recheck that setting
against the public Cfx Enhanced artifact documentation before using Varde in
production.

The recipe tracks Varde's `main` branch while the framework is pre-alpha. Once
versioned releases exist, the recipe should be changed to install a pinned
release so that repeat deployments are reproducible.
