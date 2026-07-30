# Contributing

Contributions are welcome. Keep the runtime local, progressive, and framework-neutral.

Before opening a pull request, run:

```sh
npm install
npm run check
npm run build
npm pack --dry-run
```

Keep native WebMCP access behind `src/platform/index.ts`, add tests for behavior changes, and update architecture or roadmap docs when boundaries change. Do not add network calls, telemetry, private API access, or behavior that makes the host page depend on this package.
