# Browser bridge installation and injection

Read this file only after the capability gate in `SKILL.md` establishes that
the selected browser supports writable Playwright, Puppeteer, or explicitly
approved CDP script injection.

## Contents

- Local npm installation
- Playwright injection
- Puppeteer injection
- Remote bundle fallback
- Restricted browser hosts
- Navigation and cleanup

## Local npm installation

Prefer an already installed compatible version. Otherwise, install the runtime
in the browser automation project without changing its declared dependencies:

```sh
npm install --no-save --package-lock=false @gr3p/universal-webmcp
```

Do not install globally. Do not install into a website's production project
unless the user asked to integrate that application. For disposable browsing,
use the automation workspace or an isolated temporary Node project.

Resolve the exported IIFE through the package export map rather than guessing a
`node_modules` path:

```js
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const webmcpBundlePath = require.resolve(
  '@gr3p/universal-webmcp/browser.iife.js',
);
```

## Playwright injection

Use this only with a Playwright `Page` that supports `addScriptTag` and writable
`evaluate`:

```js
await page.addScriptTag({ path: webmcpBundlePath });

await page.evaluate(() => {
  const previous = globalThis.__agentReadyWebMCP;
  if (previous?.owner === 'agent') previous.runtime.destroy();

  const runtime = globalThis.AgentReadyWebMCP.createWebMCPRuntime({
    mode: 'hybrid',
    confirmationPolicy: 'risk-based',
    autoStart: true,
    observe: true,
  });

  globalThis.__agentReadyWebMCP = {
    owner: 'agent',
    runtime,
  };
});
```

Read a compact catalog across the browser boundary:

```js
const catalog = await page.evaluate(() => {
  const runtime =
    globalThis.__agentReadyWebMCP?.runtime ??
    globalThis.AgentReadyWebMCP?.autoRuntime;

  if (!runtime) return [];

  return runtime.listTools()
    .filter((tool) =>
      tool.status !== 'unavailable' &&
      tool.status !== 'deprecated' &&
      tool.lifecycle !== 'disabled' &&
      tool.lifecycle !== 'removed')
    .map(({
      name,
      description,
      kind,
      inputSchema,
      outputSchema,
      risk,
      provenance,
      targetUI,
      status,
      lifecycle,
    }) => ({
      name,
      description,
      kind,
      inputSchema,
      outputSchema,
      risk,
      provenance,
      targetUI,
      status,
      lifecycle,
    }));
});
```

Invoke one selected tool:

```js
const result = await page.evaluate(
  async ({ name, input }) => {
    const runtime =
      globalThis.__agentReadyWebMCP?.runtime ??
      globalThis.AgentReadyWebMCP?.autoRuntime;
    if (!runtime) return { status: 'error', code: 'runtime-unavailable' };
    return runtime.invokeTool(name, input);
  },
  { name: selectedTool.name, input },
);
```

## Puppeteer injection

Puppeteer can inject the same local bundle:

```js
await page.addScriptTag({ path: webmcpBundlePath });
```

Then use the Playwright initialization, catalog, and invocation page functions
unchanged through Puppeteer's writable `page.evaluate`.

## Remote bundle fallback

Use a remote bundle only when local npm installation is unavailable and the
user permits loading a public third-party resource into the page. Prefer a
version-pinned npm-backed URL:

```js
await page.addScriptTag({
  url: 'https://cdn.jsdelivr.net/npm/@gr3p/universal-webmcp@0.1.3/dist/browser.iife.js',
});
```

Then initialize `__agentReadyWebMCP` exactly as shown above. Do not use an
unpinned URL for repeatable QA or production automation.

If Content Security Policy, Trusted Types, browser policy, or the site blocks
the script, stop. Do not weaken the site's policy or switch to an address-bar
or bookmarklet workaround.

## Restricted browser hosts

Some browser hosts expose only clicks, typing, screenshots, semantic snapshots,
and read-only evaluation. In that environment:

1. Check for native WebMCP tools or an existing
   `AgentReadyWebMCP.autoRuntime`.
2. Use them when present.
3. Otherwise return to targeted semantic browser operations.

Do not call `addScriptTag`, mutate the document in `evaluate`, navigate to a
`javascript:` URL, or use a page form to execute code when the host does not
document that capability.

Codex Developer mode/full CDP is a separate privileged path. Obtain the
approval required by the Codex browser host before using it, and use only its
documented CDP methods. Do not treat skill installation as approval for CDP.

## Navigation and cleanup

A document navigation destroys the injected runtime and its bridge. After the
new document reaches the required load state:

1. Re-run the capability gate.
2. Re-inject only when still permitted.
3. Read a new compact catalog.

For same-document SPA transitions, keep the existing runtime and use
`waitForIdle()`, `waitForTool(name)`, or one catalog refresh.

Before releasing a page that did not navigate, destroy only the agent-owned
runtime:

```js
await page.evaluate(() => {
  if (globalThis.__agentReadyWebMCP?.owner === 'agent') {
    globalThis.__agentReadyWebMCP.runtime.destroy();
    delete globalThis.__agentReadyWebMCP;
  }
});
```
