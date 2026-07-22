# Currency War Data Contract

Currency War data is committed as versioned snapshots under `data/currency-war`.
Import an approved baseline with:

```powershell
npm.cmd run currency-war:import -- --source "<baseline-root>" --target "data\\currency-war" --game-version 4.4
```

The importer requires all ten files in `canonical/v3` and all seven files in
`runtime/4.4`. It copies only those Canonical and Runtime snapshots into the
repository. It never stores a Desktop-path reference or copies the source
package's staging data. The resulting `manifests/import-4.4.json` records the
source package version, target game version, import timestamp, imported paths,
and SHA-256 hashes.

Validate the committed runtime snapshot before building gameplay features:

```powershell
npm.cmd run currency-war:data-check
```

The command validates every runtime JSON file, verifies cross-file IDs (such as
character-to-bond references), and reports record counts plus the availability
of investment-environment and complete game-rule data. For an isolated snapshot
in a test or import review, pass `--runtime-dir <path>`.
