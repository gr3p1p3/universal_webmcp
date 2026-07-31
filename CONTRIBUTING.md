# Contributing

Contributions are welcome. Keep the runtime local, progressive, and framework-neutral.

Unless a separate written contributor agreement applies, contributions are
submitted under the project's `AGPL-3.0-only` license. Contributors retain
copyright in their contributions and must have the right to submit them.

Before opening a pull request, run:

```sh
npm install
npm run check
npm run build
npm pack --dry-run
```

Keep native WebMCP access behind `src/platform/index.ts`, add tests for behavior changes, and update architecture or roadmap docs when boundaries change. Do not add network calls, telemetry, private API access, or behavior that makes the host page depend on this package.

Before publishing an npm release, push the immutable `v<package version>` Git
tag and verify that `NOTICE` and `README.md` link to it. The tagged source must
remain available as the Corresponding Source for the distributed build.
