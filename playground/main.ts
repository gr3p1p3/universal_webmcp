import {
  BrowserModelContextAdapter,
  createManualMappingTool,
  createWebMCPRuntime,
  evaluateToolPolicy,
  type JsonObject,
  type JsonValue,
  type RuntimeTool,
// Vite resolves the playground directly from the library's TypeScript source entry.
// @ts-expect-error The repository typecheck intentionally does not enable TS-extension imports.
} from '../src/index.ts';

type Product = { name: string; category: string; price: number; description: string };
type Check = { name: string; run: () => void | Promise<void> };
type AgentFacingTool = {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly execute: (input: object) => Promise<JsonValue>;
  readonly annotations: { readonly readOnlyHint: boolean; readonly untrustedContentHint: boolean };
};

class PlaygroundModelContextBridge {
  private readonly registrations = new Map<string, AgentFacingTool>();
  public readonly interactions: JsonObject[] = [];
  public interactionResult: JsonObject = { confirmed: true };

  public registerTool(
    tool: AgentFacingTool,
    options: { readonly signal?: AbortSignal } = {},
  ): void {
    this.registrations.set(tool.name, tool);
    const unregister = (): void => {
      if (this.registrations.get(tool.name) === tool) this.registrations.delete(tool.name);
    };
    if (options.signal?.aborted) unregister();
    else options.signal?.addEventListener('abort', unregister, { once: true });
  }

  public async requestUserInteraction(request: JsonObject): Promise<JsonObject> {
    this.interactions.push(request);
    return this.interactionResult;
  }

  public registeredTools(): readonly AgentFacingTool[] {
    return [...this.registrations.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
}

const products: Product[] = [
  { name: 'Trail shoes', category: 'footwear', price: 94, description: 'Light grip for local paths.' },
  { name: 'City shell', category: 'layers', price: 128, description: 'Packable weather protection.' },
  { name: 'Day hike pack', category: 'packs', price: 76, description: 'Comfortable carry for a day out.' },
  { name: 'Alpine fleece', category: 'layers', price: 84, description: 'Warm mid-layer for cool starts.' },
  { name: 'Ridge sandals', category: 'footwear', price: 58, description: 'Simple, flexible summer comfort.' },
  { name: 'Commuter tote', category: 'packs', price: 42, description: 'A compact everyday carry.' },
];

const $ = <T extends Element = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
function clear(element: Element): void { while (element.firstChild) element.removeChild(element.firstChild); }
function text(element: Element, value: string): void { element.textContent = value; }
function cell(value: string, className?: string): HTMLTableCellElement {
  const item = document.createElement('td');
  if (className) item.className = className;
  item.textContent = value;
  return item;
}
const modelContext = new PlaygroundModelContextBridge();
const adapter = new BrowserModelContextAdapter(modelContext);
const expectedApplicationToolNames = [
  'filter-category',
  'item.add-to-cart.products',
  'next-page',
  'open-product-details',
  'open-quick-menu',
  'previous-page',
  'query.products',
  'search-products',
  'show-products',
  'show-saved',
  'sort-products',
] as const;
const runtime = createWebMCPRuntime({
  root: document,
  mode: 'hybrid',
  adapter,
  autoDiscover: true,
  observe: true,
  observerOptions: { debounceMs: 25 },
});
let cart = 0;
let page = 1;
let dynamicControl: HTMLButtonElement | undefined;

function log(message: string): void {
  const consoleElement = $('#console');
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  consoleElement.textContent = consoleElement.textContent === 'Local console ready. Input values are intentionally not logged.' ? line : `${consoleElement.textContent}\n${line}`;
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

async function invokeQaTool(name: string, input: JsonObject = {}): Promise<unknown> {
  if (!runtime.listTools().some((tool) => tool.name === name)) throw new Error(`tool not discovered: ${name}`);
  const result = await runtime.invokeTool(name, input);
  if (typeof result === 'object' && result !== null && 'status' in result && result.status !== 'ok') {
    throw new Error(`tool invocation failed: ${name}`);
  }
  return result;
}

function renderProducts(): void {
  const query = $<HTMLInputElement>('#query').value.trim().toLowerCase();
  const category = $<HTMLSelectElement>('#category').value;
  const sort = $<HTMLSelectElement>('#sort').value;
  let visible = products.filter((item) => (category === 'all' || item.category === category) && (!query || `${item.name} ${item.description}`.toLowerCase().includes(query)));
  if (sort === 'price-low') visible = [...visible].sort((a, b) => a.price - b.price);
  if (sort === 'price-high') visible = [...visible].sort((a, b) => b.price - a.price);
  const pageItems = visible.slice((page - 1) * 3, page * 3);
  const productList = $('#product-list');
  clear(productList);
  if (pageItems.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    text(empty, 'No local products match those filters.');
    productList.append(empty);
  }
  pageItems.forEach((item) => {
    const article = document.createElement('li');
    article.className = 'product';
    article.dataset.product = item.name.toLowerCase().replace(/[^a-z]+/g, '-');
    const heading = document.createElement('h3'); text(heading, item.name);
    const description = document.createElement('span'); description.className = 'muted'; text(description, item.description);
    const price = document.createElement('span'); price.className = 'price'; text(price, `€${item.price}`);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'add-to-cart';
    button.setAttribute('aria-label', `Add ${item.name} to cart`);
    text(button, 'Add to cart');
    article.append(heading, description, price, button);
    productList.append(article);
  });
  text($('#result-count'), `${visible.length} result${visible.length === 1 ? '' : 's'}`);
  text($('#page-label'), `Page ${page} of ${Math.max(1, Math.ceil(visible.length / 3))}`);
  $('#page-prev').toggleAttribute('disabled', page === 1);
  $('#page-next').toggleAttribute('disabled', page >= Math.max(1, Math.ceil(visible.length / 3)));
}

function updateInventory(): void {
  const tools = runtime.listTools();
  const agentTools = modelContext.registeredTools();
  text($('#capability-count'), String(tools.length));
  text($('#agent-tool-count'), String(agentTools.length));
  text($('#agent-surface-state'), runtime.isRunning() ? 'exposed to agents' : 'not exposed');
  $('#agent-surface-state').className = `pill${runtime.isRunning() ? '' : ' warn'}`;
  const agentSurface = $('#agent-tool-list');
  clear(agentSurface);
  if (agentTools.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    text(empty, 'No tools are registered on the WebMCP bridge.');
    agentSurface.append(empty);
  }
  agentTools.slice(0, 8).forEach((tool) => {
    const item = document.createElement('li');
    const name = document.createElement('code');
    text(name, tool.name);
    const detail = document.createElement('span');
    text(detail, ` — ${tool.description}`);
    item.append(name, detail);
    agentSurface.append(item);
  });
  if (agentTools.length > 8) {
    const remainder = document.createElement('li');
    remainder.className = 'muted';
    text(remainder, `…and ${agentTools.length - 8} more registered tools`);
    agentSurface.append(remainder);
  }
  text($('#inventory-status'), runtime.isRunning() ? 'live' : 'stopped');
  $('#inventory-status').className = `pill${runtime.isRunning() ? '' : ' warn'}`;
  const inventory = $('#inventory-body');
  clear(inventory);
  if (tools.length === 0) {
    const row = document.createElement('tr');
    const empty = cell('No capabilities registered.'); empty.colSpan = 7; empty.className = 'muted';
    row.append(empty); inventory.append(row);
  }
  tools.forEach((tool) => {
    const row = document.createElement('tr');
    const name = cell(tool.name); const strong = document.createElement('strong'); text(strong, tool.name); clear(name); name.append(strong);
    const risk = cell(tool.risk.level); risk.className = `pill${['high', 'critical'].includes(tool.risk.level) ? ' warn' : ''}`;
    row.append(name, cell(tool.kind), cell(tool.provenance.source), cell(`${Math.round(tool.provenance.confidence * 100)}%`), risk, cell(tool.targetUI?.selector ?? '—'), cell(tool.status ?? tool.lifecycle ?? 'available'));
    inventory.append(row);
  });
  const diagnostics = runtime.diagnostics;
  text($('#diagnostics'), diagnostics.length ? diagnostics.map((item) => `${item.code}${item.toolName ? ` · ${item.toolName}` : ''}: ${item.message}`).join('\n') : 'No diagnostics. The runtime is keeping all activity in this page.');
}

function runRegistrationProof(): void {
  runtime.stop();
  const before = modelContext.registeredTools().length;
  runtime.start();
  const activeTools = modelContext.registeredTools();
  runtime.stop();
  const after = modelContext.registeredTools().length;
  runtime.start();

  text($('#proof-before'), String(before));
  text($('#proof-active'), String(activeTools.length));
  text($('#proof-after'), String(after));
  text($('#registration-proof'), JSON.stringify({
    runtimeStopped: before,
    runtimeActive: activeTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
    runtimeStoppedAgain: after,
  }, null, 2));
  setRuntimeState();
  log(`registration proof: ${before} stopped → ${activeTools.length} active → ${after} stopped`);
}

function setRuntimeState(): void {
  text($('#runtime-state'), runtime.isRunning() ? 'Runtime running · hybrid' : 'Runtime stopped');
  $('#runtime-dot').classList.toggle('live', runtime.isRunning());
  updateInventory();
}

function addToCart(): void { cart += 1; $('#cart-status').textContent = `Cart has ${cart} item${cart === 1 ? '' : 's'} · local only`; log('cart action completed (payload omitted)'); }

function openMenu(): void { const menu = $('#quick-menu'); menu.hidden = !menu.hidden; $('#menu-button').setAttribute('aria-expanded', String(!menu.hidden)); }

function resetScenario(): void {
  cart = 0;
  page = 1;
  $<HTMLInputElement>('#query').value = '';
  $<HTMLSelectElement>('#category').value = 'all';
  $<HTMLSelectElement>('#sort').value = 'featured';
  $('#cart-status').textContent = 'Cart is empty';
  $('#quick-menu').hidden = true;
  $('#menu-button').setAttribute('aria-expanded', 'false');
  $<HTMLDialogElement>('#product-dialog').close();
  $('#tab-products').setAttribute('aria-selected', 'true');
  $('#tab-saved').setAttribute('aria-selected', 'false');
  $('#panel-products').hidden = false;
  $('#panel-saved').hidden = true;
  renderProducts();
  log('scenario reset');
}

function injectControl(): void { if (dynamicControl) return; dynamicControl = document.createElement('button'); dynamicControl.id = 'dynamic-control'; dynamicControl.type = 'button'; dynamicControl.textContent = 'Dynamic local control'; dynamicControl.dataset.webmcpTool = 'dynamic-local-control'; dynamicControl.dataset.webmcpAction = 'click'; dynamicControl.addEventListener('click', () => log('dynamic control clicked')); $('#panel-products').append(dynamicControl); log('dynamic control injected; observer will rescan'); }
function removeControl(): void { dynamicControl?.remove(); dynamicControl = undefined; log('dynamic control removed; observer will rescan'); }

function cleanupQaTools(): void {
  runtime.unregisterTool('qa.manual-details');
  runtime.unregisterTool('qa.confirmed-details');
}

const checks: Check[] = [
  { name: 'Discovery exposes only the application catalog', run: () => { const names = runtime.listTools().map((tool) => tool.name).sort(); if (JSON.stringify(names) !== JSON.stringify(expectedApplicationToolNames)) throw new Error(`unexpected application catalog: ${names.join(', ')}`); } },
  { name: 'Runtime publishes and revokes agent-facing WebMCP tools', run: () => { runtime.stop(); if (modelContext.registeredTools().length !== 0) throw new Error('bridge retained tools while stopped'); runtime.start(); const names = modelContext.registeredTools().map((tool) => tool.name); if (JSON.stringify(names) !== JSON.stringify(expectedApplicationToolNames)) throw new Error(`unexpected agent-facing catalog: ${names.join(', ')}`); runtime.stop(); if (modelContext.registeredTools().length !== 0) throw new Error('bridge did not revoke registrations'); runtime.start(); } },
  { name: 'Fill and search stay local', run: async () => { await invokeQaTool('search-products', { fields: { query: 'trail' } }); if (!$('#result-count').textContent?.includes('1')) throw new Error('local search did not filter results'); await invokeQaTool('search-products', { fields: { query: '' } }); } },
  { name: 'Select and filter update the catalog', run: async () => { await invokeQaTool('filter-category', { value: 'packs' }); if (!$('#result-count').textContent?.includes('2')) throw new Error('category filter failed'); await invokeQaTool('filter-category', { value: 'all' }); } },
  { name: 'Grouped cart action targets one repeated item by index', run: async () => { resetScenario(); await invokeQaTool('item.add-to-cart.products', { index: 1 }); if (!$('#cart-status').textContent?.includes('1 item')) throw new Error('grouped cart action did not update the UI'); } },
  { name: 'Click, tabs, menu, and modal respond', run: async () => { await invokeQaTool('show-saved'); if (!$('#panel-saved').hidden) { /* expected visible */ } else throw new Error('tab did not open'); await invokeQaTool('open-quick-menu'); if ($('#quick-menu').hidden) throw new Error('menu did not open'); await invokeQaTool('open-product-details'); if (!$<HTMLDialogElement>('#product-dialog').open) throw new Error('dialog did not open'); $<HTMLDialogElement>('#product-dialog').close(); await invokeQaTool('show-products'); await invokeQaTool('open-quick-menu'); if (!$('#quick-menu').hidden) throw new Error('menu did not close'); } },
  { name: 'Manual mapping registers a local tool', run: async () => { runtime.unregisterTool('qa.manual-details'); const tool = createManualMappingTool({ name: 'qa.manual-details', selector: '#details-button', action: 'click', root: document, risk: { level: 'low' } }); runtime.registerTool(tool); if (!runtime.listTools().some((item) => item.name === 'qa.manual-details' && item.provenance.source === 'manual')) throw new Error('manual mapping not registered'); await invokeQaTool('qa.manual-details'); if (!$<HTMLDialogElement>('#product-dialog').open) throw new Error('manual mapping did not click the UI'); $<HTMLDialogElement>('#product-dialog').close(); } },
  { name: 'Observer tracks dynamic injection and removal', run: async () => { injectControl(); await new Promise((resolve) => setTimeout(resolve, 60)); if (!runtime.listTools().some((tool) => tool.name.includes('dynamic-local-control'))) throw new Error('injected control not discovered'); removeControl(); await new Promise((resolve) => setTimeout(resolve, 60)); if (runtime.listTools().some((tool) => tool.name.includes('dynamic-local-control'))) throw new Error('removed control still present'); } },
  { name: 'Policy denies critical tools without invoking them', run: () => { const critical: RuntimeTool = { name: 'qa.critical', description: 'A local policy fixture', kind: 'action', inputSchema: { type: 'object' }, risk: { level: 'critical' }, provenance: { source: 'manual', confidence: 1 }, handler: () => { throw new Error('must not invoke'); } }; const decision = evaluateToolPolicy(critical, 'hybrid'); if (decision.decision !== 'deny') throw new Error(`expected deny, got ${decision.decision}`); } },
  { name: 'Policy confirms a risky local action', run: async () => { runtime.unregisterTool('qa.confirmed-details'); resetScenario(); const risky = createManualMappingTool({ name: 'qa.confirmed-details', selector: '#details-button', action: 'click', root: document, risk: { level: 'high' } }); runtime.registerTool(risky); const decision = runtime.getPolicyDecision(risky); if (decision?.decision !== 'confirm') throw new Error('expected confirmation'); modelContext.interactionResult = { confirmed: false }; const rejectedInteractions = modelContext.interactions.length; const blocked = await runtime.invokeTool(risky.name, {}); if ((blocked as { status?: string }).status !== 'blocked' || modelContext.interactions.length !== rejectedInteractions + 1 || $<HTMLDialogElement>('#product-dialog').open) throw new Error('rejected call was not blocked before click'); modelContext.interactionResult = { confirmed: true }; const allowedInteractions = modelContext.interactions.length; const allowed = await runtime.invokeTool(risky.name, {}); if ((allowed as { status?: string }).status !== 'ok' || modelContext.interactions.length !== allowedInteractions + 1 || !$<HTMLDialogElement>('#product-dialog').open) throw new Error('confirmed call did not click the UI'); $<HTMLDialogElement>('#product-dialog').close(); modelContext.interactionResult = { confirmed: true }; } },
];

async function runAll(): Promise<void> {
  if (!runtime.isRunning()) runtime.start();
  cleanupQaTools(); removeControl(); resetScenario();
  const results: { check: Check; ok: boolean; error?: string }[] = [];
  for (const check of checks) { try { await check.run(); results.push({ check, ok: true }); } catch (error) { results.push({ check, ok: false, error: error instanceof Error ? error.message : 'check failed' }); } }
  const passed = results.filter((result) => result.ok).length;
  text($('#pass-count'), String(passed)); text($('#fail-count'), String(results.length - passed)); text($('#total-count'), String(results.length)); text($('#test-count'), String(results.length)); text($('#suite-status'), passed === results.length ? 'all pass' : 'review failures'); $('#suite-status').className = `pill${passed === results.length ? '' : ' fail'}`;
  const testList = $('#test-list'); clear(testList);
  results.forEach((result) => {
    const row = document.createElement('div'); row.className = `test-row ${result.ok ? 'pass' : 'fail'}`;
    const icon = document.createElement('span'); icon.className = 'icon'; text(icon, result.ok ? '✓' : '×');
    const content = document.createElement('span'); const name = document.createElement('strong'); text(name, result.check.name); content.append(name);
    if (result.error) { const error = document.createElement('span'); error.className = 'muted'; text(error, ` · ${result.error}`); content.append(error); }
    row.append(icon, content); testList.append(row);
  });
  cleanupQaTools(); updateInventory(); log(`test suite finished: ${passed}/${results.length} passed`);
}

$('#search-form').addEventListener('submit', (event) => { event.preventDefault(); page = 1; renderProducts(); log('search submitted locally (query omitted)'); });
$<HTMLInputElement>('#query').addEventListener('input', () => { page = 1; renderProducts(); });
$<HTMLSelectElement>('#category').addEventListener('change', () => { page = 1; renderProducts(); log('category filter changed locally'); });
$<HTMLSelectElement>('#sort').addEventListener('change', () => { page = 1; renderProducts(); log('sort changed locally'); });
$('#product-list').addEventListener('click', (event) => { if ((event.target as HTMLElement).closest('.add-to-cart')) addToCart(); });
$('#menu-button').addEventListener('click', openMenu); $('#menu-close').addEventListener('click', openMenu);
$('#details-button').addEventListener('click', () => $<HTMLDialogElement>('#product-dialog').showModal());
$('#tab-products').addEventListener('click', () => { $('#tab-products').setAttribute('aria-selected', 'true'); $('#tab-saved').setAttribute('aria-selected', 'false'); $('#panel-products').hidden = false; $('#panel-saved').hidden = true; });
$('#tab-saved').addEventListener('click', () => { $('#tab-products').setAttribute('aria-selected', 'false'); $('#tab-saved').setAttribute('aria-selected', 'true'); $('#panel-products').hidden = true; $('#panel-saved').hidden = false; });
$('#page-prev').addEventListener('click', () => { page = Math.max(1, page - 1); renderProducts(); }); $('#page-next').addEventListener('click', () => { page += 1; renderProducts(); });
$('#start-runtime').addEventListener('click', () => { runtime.start(); setRuntimeState(); log('runtime started'); }); $('#stop-runtime').addEventListener('click', () => { runtime.stop(); setRuntimeState(); log('runtime stopped'); }); $('#run-registration-proof').addEventListener('click', runRegistrationProof); $('#reset-scenario').addEventListener('click', resetScenario); $('#inject-control').addEventListener('click', injectControl); $('#remove-control').addEventListener('click', removeControl); $('#run-all').addEventListener('click', () => { void runAll(); }); $('#clear-console').addEventListener('click', () => { $('#console').textContent = 'Local console cleared. Input values are intentionally not logged.'; });
$('#add-mapping').addEventListener('click', () => { try { const tool = createManualMappingTool({ name: $<HTMLInputElement>('#manual-name').value.trim(), selector: $<HTMLInputElement>('#manual-selector').value.trim(), action: $<HTMLSelectElement>('#manual-action').value as 'click' | 'fill' | 'select' | 'submit', root: document, risk: { level: 'low' } }); runtime.registerTool(tool); $('#mapping-status').textContent = `Mapped ${tool.name} locally.`; log('manual mapping added (name and selector are not echoed)'); updateInventory(); } catch { $('#mapping-status').textContent = 'Mapping could not be added. Check the name and selector.'; } });

renderProducts(); runtime.start(); setRuntimeState(); log('runtime started with an instrumented WebMCP bridge; no network calls');
