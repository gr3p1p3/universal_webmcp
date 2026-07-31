# Browser bridge installation and injection

Read this reference only after the capability gate confirms a writable
Playwright, Puppeteer, or explicitly approved full-CDP page context.

## Contents

- Prerequisites and local bundle resolution
- Playwright and Puppeteer injection
- Permissioned remote fallback
- Navigation and cleanup

## Prerequisites

- Use Node.js 20 or newer.
- Prefer an already installed compatible package.
- Do not install globally or change a website's declared dependencies unless the
  user requested application integration.
- Stop if browser policy, Content Security Policy, or Trusted Types blocks
  injection. Do not weaken the policy.

## Resolve the local bundle

For a disposable automation workspace or isolated temporary Node project:

```sh
npm install --no-save --package-lock=false @gr3p/universal-webmcp@0.2.1
```

Resolve the public export instead of guessing a `node_modules` path:

```js
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const webmcpBundlePath = require.resolve(
  '@gr3p/universal-webmcp/browser.iife.js',
);
const webmcpOwnerToken = randomUUID();
```

## Inject with Playwright

Use a `Page` that supports `addScriptTag` and writable `evaluate`:

```js
await page.addScriptTag({ path: webmcpBundlePath });

await page.evaluate(({ ownerToken }) => {
  const previous = globalThis.__agentReadyWebMCP;
  if (previous?.owner === 'agent' && previous.ownerToken === ownerToken) {
    previous.runtime.destroy();
  } else if (previous) {
    throw new Error('A different WebMCP agent bridge already owns this page.');
  }

  const runtime = globalThis.AgentReadyWebMCP.createWebMCPRuntime({
    mode: 'hybrid',
    confirmationPolicy: 'risk-based',
    autoStart: true,
    observe: true,
  });

  globalThis.__agentReadyWebMCP = { owner: 'agent', ownerToken, runtime };
}, { ownerToken: webmcpOwnerToken });
```

Run the compact-index and selected-descriptor snippets from `SKILL.md` inside
`page.evaluate`. Pass only JSON-compatible names and inputs across the boundary:

```js
const result = await page.evaluate(
  async ({ name, input }) => {
    const runtime =
      globalThis.AgentReadyWebMCP?.autoRuntime ??
      globalThis.__agentReadyWebMCP?.runtime;
    if (!runtime) {
      return { status: 'error', error: 'runtime-unavailable' };
    }
    return runtime.invokeTool(name, input);
  },
  { name: selectedDescriptor.name, input },
);
```

## Inject with Puppeteer

Use the same local bundle and initialization:

```js
await page.addScriptTag({ path: webmcpBundlePath });
```

The page functions above work unchanged through Puppeteer's writable
`page.evaluate`.

## Coordinate full navigation

For a tool expected to replace the document, arm the browser host's documented
main-frame navigation wait before invoking it and await both operations
together. If navigation succeeds while `page.evaluate` rejects because its
execution context was destroyed, treat the invocation result as indeterminate,
verify the destination, and do not retry a mutation solely because the result
could not cross the old document boundary.

For same-document navigation, await the declared URL or visible-state change
and keep the current runtime. After full navigation, discard every descriptor,
runtime handle, and selector from the old document before re-running the gate.

## Use a remote bundle only with permission

Use a public remote bundle only when local package injection is unavailable and
the user permits loading third-party code into the page. Pin the verified
release:

```js
await page.addScriptTag({
  url: 'https://cdn.jsdelivr.net/npm/@gr3p/universal-webmcp@0.2.1/dist/browser.iife.js',
});
```

Initialize the agent-owned bridge exactly as above. Do not use an unpinned URL
for repeatable automation.

## Navigate and clean up

A full document navigation destroys the injected bundle, runtime, and bridge.
After load, re-run the capability gate and inject only if the new page and host
still permit it. Keep the runtime for same-document transitions and synchronize
with `waitForIdle()`, `waitForTool()`, or one `refresh()`.

Before releasing a page that did not navigate, destroy only the agent-owned
runtime:

```js
await page.evaluate(({ ownerToken }) => {
  const bridge = globalThis.__agentReadyWebMCP;
  if (bridge?.owner === 'agent' && bridge.ownerToken === ownerToken) {
    bridge.runtime.destroy();
    delete globalThis.__agentReadyWebMCP;
  }
}, { ownerToken: webmcpOwnerToken });
```

Never destroy a site-owned `AgentReadyWebMCP.autoRuntime`.
