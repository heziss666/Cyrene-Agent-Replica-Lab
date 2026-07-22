# Currency War Data Contract

Currency War data is committed as versioned snapshots under `data/currency-war`.
The application reads the compact `simple/4.4` source snapshot after it is
imported into `data/currency-war/runtime/4.4`.
Import an approved baseline with:

```powershell
npm.cmd run currency-war:import -- --source "<baseline-root>" --target "data\\currency-war" --game-version 4.4
```

The importer requires all ten files in `canonical/v3` and the five active files
in `simple/4.4`. It keeps Canonical data as the source/evidence layer, while the
runtime snapshot contains only the compact character, bond, equipment,
investment-strategy, and investment-environment JSON files. It never stores a
Desktop-path reference, imports hashed entity IDs, or copies validation reports.
The resulting `manifests/import-4.4.json` records the source package version,
target game version, import timestamp, imported paths, and SHA-256 hashes.

Validate the committed runtime snapshot before building gameplay features:

```powershell
npm.cmd run currency-war:data-check
```

The command validates every compact runtime JSON file, verifies cross-file names
(such as character-to-bond references), and reports record counts plus the
availability of investment-environment data. Economy rules are intentionally
outside this first compact snapshot. For an isolated snapshot in a test or
import review, pass `--runtime-dir <path>`.
