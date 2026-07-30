# Universal WebMCP Runtime

Turn an existing web UI into a compact, inspectable tool surface for browser agents — without replacing the frontend, exposing a private API, or moving page data to a server.

[`@gr3p/universal-webmcp`](https://www.npmjs.com/package/@gr3p/universal-webmcp) addresses both sides of a browser-agent integration:

| If you are… | Use the project to… | Entry point |
|---|---|---|
| A web developer | Expose existing forms, actions, navigation, and visible data as policy-governed tools | [Website integration](#website-integration) |
| An agent user or automation author | Let Codex, Claude, and compatible agents detect or install the runtime, select a compact tool, and avoid repeated page-wide extraction | [Agent integration](#agent-integration) |

Both paths use the same local runtime: `listTools()` returns non-invocable JSON descriptors, while `invokeTool()` operates the visible UI through its existing session, validation, and application feedback. Agent-side injection is used only when the browser host explicitly provides a writable Playwright, Puppeteer, or approved CDP bridge.

```text
Existing page UI → discover capabilities → apply policy → agent invokes visible UI
```

![The Last DOM — turning chaotic page structure into a clean WebMCP tool surface](https://raw.githubusercontent.com/gr3p1p3/universal_webmcp/main/assets/universal-webmcp-last-dom.png)

## Design goals

Most websites are built for people. Agents need the same experience in a form they can reliably inspect and invoke.

Universal WebMCP Runtime adds that layer on top of the page you already have:

- **Progressive enhancement:** the page stays fully usable when the runtime is absent.
- **Local and session-preserving:** actions use the visible UI, current authentication state, validation, and application feedback.
- **Less context overhead:** agents select a small structured tool instead of repeatedly ingesting the whole DOM or accessibility tree.
- **Safe by default:** risk, confidence, authorization, allowlists, and user confirmation share one policy path.
- **Works with dynamic apps:** reconciliation covers DOM changes, SPA navigation, open shadow roots, same-origin frames, and explicit app invalidation events.
- **No mandatory infrastructure:** no API key, backend, remote DOM upload, or telemetry is required.

Typical use cases include e-commerce catalogs, search and filtering, dashboards, internal tools, CRM workflows, browser QA, crawling, and automation.

## Measured token footprint

The repository benchmark collects the same complete repeated-record set through five representations and tokenizes each payload with `o200k_base`. WebMCP objects use minified JSON; task prompts and model responses are excluded equally from every path.

Results measured on 2026-07-30:

| Complete collection payload | Controlled fixture, 24/24 records | Public live page, 25/25 records |
|---|---:|---:|
| Relevant region HTML | 6,662 | 244,759 |
| Relevant region ARIA snapshot | 2,901 | 10,342 |
| WebMCP result with cached catalog | 1,829 | 1,041 |
| Selected tool descriptor + input + result | 2,084 | 1,302 |
| Full catalog + input + result | 3,276 | 15,230 |

For the selected-tool path, that is 68.7% fewer tokens than HTML and 28.2% fewer than ARIA in the controlled fixture; on the live page it is 99.5% fewer than HTML and 87.4% fewer than ARIA.

This is not a blanket first-turn claim. The complete cold catalog was 12.9% larger than targeted ARIA in the fixture and 47.3% larger on the live page. The measured advantage depends on selecting the relevant descriptor or caching the catalog; cumulative WebMCP usage became smaller than repeated ARIA snapshots at the second task in both runs.

Reproduce the controlled benchmark locally, or run the explicitly separate live variant:

```sh
npm run benchmark:tokens
npm run benchmark:tokens:live
```

Both commands fail unless the collection reports `complete: true` and matching expected and collected counts. Live results vary with public page content, locale, delivery location, and experiments. Generated JSON and SVG files are written to the ignored `.benchmark/` directory.

## Website integration

```sh
npm install @gr3p/universal-webmcp
```

```ts
import { createWebMCPRuntime } from '@gr3p/universal-webmcp';

const runtime = createWebMCPRuntime({
  mode: 'hybrid',
  confirmationPolicy: 'risk-based',
});

runtime.start();

const tools = runtime.listTools();
const result = await runtime.invokeTool('search', {
  query: 'running shoes',
});

runtime.stop();    // pause observation and native registrations
runtime.destroy(); // permanently release the runtime
```

The root import is ESM and has no import-time browser side effect. For a script-tag integration, load the IIFE hosted on GitHub Pages and opt into auto-start explicitly:

```html
<script
  src="https://gr3p1p3.github.io/universal_webmcp/webmcp-runtime.iife.js"
  data-webmcp-auto
></script>
<script>
  const tools = AgentReadyWebMCP.autoRuntime?.listTools();
</script>
```

For a version-pinned URL backed by the npm release, use jsDelivr:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@gr3p/universal-webmcp@0.1.2/dist/browser.iife.js"
  data-webmcp-auto
></script>
```

An ESM browser entry is also available:

```ts
import { createWebMCPRuntime } from '@gr3p/universal-webmcp/browser';
```

The GitHub Pages URL follows the current `main` build. Prefer the version-pinned npm URL when reproducibility matters.

## What the runtime exposes

| Capability | What an agent can do | How it is created |
|---|---|---|
| Query | Read repeated lists, result regions, and visible structured content | Deterministic discovery |
| Form | Fill and submit safe, visible text fields | Discovery or explicit mapping |
| Action | Click, select, toggle, navigate, or operate a repeated item | Discovery or explicit mapping |
| Native tool registration | Share approved tools with a browser model-context implementation | Optional adapter |
| Synchronization | Wait for a tool or for the UI to become idle | `refresh()`, `waitForTool()`, `waitForIdle()` |

The runtime supports four modes:

- `hybrid` — explicit and adapter-provided tools plus local discovery; the default.
- `auto` — discover capabilities from the current UI.
- `explicit` — use only application-registered tools.
- `adapter` — use trusted tools supplied by the browser adapter.

## Make important workflows stable

Discovery is useful for general UI capabilities. For business-critical or fragile workflows, give the application a stable, owned contract with a manual mapping:

```ts
import {
  createManualMappingTool,
  createWebMCPRuntime,
} from '@gr3p/universal-webmcp';

const runtime = createWebMCPRuntime({ mode: 'hybrid' });

runtime.registerTool(createManualMappingTool({
  name: 'search.products',
  selector: 'form[aria-label="Product search"]',
  action: 'submit',
  kind: 'form',
  description: 'Search the visible product catalog by query.',
  inputSchema: {
    type: 'object',
    properties: { fields: { type: 'object' } },
  },
  risk: { level: 'low' },
}));

runtime.start();
```

Manual mappings resolve their selector at invocation time, so ordinary re-rendering does not require rebuilding the runtime. Prefer stable, application-owned selectors and accessible names.

You can also improve discovery with semantic HTML and optional WebMCP metadata:

```html
<form
  role="search"
  aria-label="Product search"
  data-webmcp-tool="search-products"
  data-webmcp-description="Search the visible product catalog by query."
>
  <label for="query">Search products</label>
  <input id="query" name="query" type="search" />
  <button type="submit">Search</button>
</form>
```

## Built for safe browser automation

`invokeTool()` and native registration use the same policy decision path. Mutating or low-confidence actions can require user confirmation; critical-risk actions can be denied automatically.

Important defaults and boundaries:

- Automatically discovered form filling skips hidden, password, file, checkbox, radio, disabled, `aria-hidden`, `aria-disabled`, and `inert` controls.
- Action results never return field values.
- Repeated controls are collapsed into indexed tools instead of creating one tool per row or product.
- Scroll-backed lists can load incrementally and return a `completeness` object; callers should check `completeness.complete` before treating a result as exhaustive.
- The runtime never reads cookies or tokens, executes arbitrary code, crosses origin boundaries, bypasses CAPTCHA/authentication, or reverse-engineers private APIs.

For an agent-facing operating contract, use the provider-neutral [agent skill](skills/universal-webmcp-runtime/SKILL.md). It teaches an agent to detect an existing runtime, install and inject the npm bundle only through a supported browser bridge, cache a compact catalog, invoke structured tools, and fall back safely when injection is unavailable.

## Agent integration

The skill follows the open Agent Skills folder format and can be used by Codex,
Claude Code, and compatible agents.

- **Codex user installation:** ask `$skill-installer` to install
  `https://github.com/gr3p1p3/universal_webmcp/tree/main/skills/universal-webmcp-runtime`.
- **Codex repository installation:** copy the
  `skills/universal-webmcp-runtime` folder to
  `.agents/skills/universal-webmcp-runtime`.
- **Claude Code user installation:** copy the folder to
  `~/.claude/skills/universal-webmcp-runtime`.
- **Claude Code repository installation:** copy the folder to
  `.claude/skills/universal-webmcp-runtime`.

Then ask the agent to browse normally. The skill activates for interactive
browsing, crawling, scraping, and browser QA. It prefers native WebMCP or an
already integrated runtime; when the host exposes approved Playwright,
Puppeteer, or CDP injection, it can install
`@gr3p/universal-webmcp` and inject the compiled IIFE. A read-only browser
surface is never treated as permission or capability to inject code.

## Keep agents synchronized with the UI

```ts
runtime.refresh();
await runtime.waitForTool('query.results', { timeoutMs: 2_000 });

const sync = await runtime.waitForIdle({
  settleMs: 100,
  timeoutMs: 2_000,
});
```

Form and action invocations wait for the UI to settle by default. Elements marked with `aria-busy="true"` or `data-webmcp-busy="true"` keep the runtime busy until the application clears them.

For state changes that do not produce useful DOM mutations, provide a framework-neutral invalidation source:

```ts
import {
  createEventInvalidationSource,
  createWebMCPRuntime,
} from '@gr3p/universal-webmcp';

const runtime = createWebMCPRuntime({
  invalidationSources: [
    createEventInvalidationSource(window, ['app:state-ready']),
  ],
});

runtime.start();
window.dispatchEvent(new Event('app:state-ready'));
```

## For agent builders

The runtime gives browser agents a compact protocol:

1. List the catalog once.
2. Select the smallest relevant tool by semantic contract.
3. Validate JSON input against its schema.
4. Invoke by stable name.
5. Verify the requested outcome and refresh only after a relevant UI change.

This replaces repeated page-wide DOM dumps with named tools, structured inputs, structured results, and explicit policy outcomes. The bundled skill works with Codex, Anthropic/Claude, and other browser-agent hosts.

## Development and verification

Requires Node.js 20 or newer.

```sh
npm install
npm run check
npm run build
npm run test:e2e:install
npm run test:e2e
npm run dev
npm pack --dry-run
```

The dev command starts the Vite playground. Unit tests use jsdom and do not require a live WebMCP implementation. The Playwright suite runs the built IIFE bundle in Chromium, Firefox, and WebKit and covers discovery, policy, lifecycle, DOM synchronization, and safe invocation.

Live smoke tests are intentionally separate from CI because external-site content and availability are not controlled by this repository:

```sh
npm run test:e2e:live
WEBMCP_LIVE_URL=https://example.com/ npm run test:e2e:live
```

The default live target is `https://www.wikipedia.org/`. Live tests inspect and invoke read-only capabilities only.

## What this is not

Universal WebMCP Runtime is not a remote MCP server, backend API replacement, CAPTCHA/authentication bypass, payment automation system, private-API reverse-engineering tool, arbitrary-code runner, cookie/token reader, or cross-origin iframe bridge. The host page must remain usable without the runtime.

## License

MIT. See [LICENSE](LICENSE).
