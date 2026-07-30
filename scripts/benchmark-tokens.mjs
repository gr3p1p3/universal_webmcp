import { chromium } from '@playwright/test';
import { getEncoding } from 'js-tiktoken';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const browserBundle = fileURLToPath(new URL('../dist/browser.iife.js', import.meta.url));
const tokenizerName = 'o200k_base';
const encoding = getEncoding(tokenizerName);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function percent(value) {
  return Math.round(value * 1_000) / 10;
}

function measurement(label, payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    label,
    bytes: Buffer.byteLength(text, 'utf8'),
    tokens: encoding.encode(text).length,
  };
}

function savings(baseline, candidate) {
  return baseline.tokens === 0 ? 0 : percent(1 - candidate.tokens / baseline.tokens);
}

function cachedBreakEvenTasks(baseline, cold, warm, maximumTasks = 1_000) {
  for (let tasks = 1; tasks <= maximumTasks; tasks += 1) {
    const baselineTokens = baseline.tokens * tasks;
    const webmcpTokens = cold.tokens + warm.tokens * (tasks - 1);
    if (webmcpTokens <= baselineTokens) return tasks;
  }
  return null;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function tokenSavingsChart(result) {
  const html = result.metrics.relevantHtml.tokens;
  const aria = result.metrics.ariaSnapshot.tokens;
  const webmcp = result.metrics.webmcpSelected.tokens;
  const htmlWidth = Math.max(3, 330 * webmcp / html);
  const ariaWidth = Math.max(3, 330 * webmcp / aria);
  const date = result.generatedAt.slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="410" viewBox="0 0 960 410" role="img" aria-labelledby="title description">
  <title id="title">Universal WebMCP token savings benchmark</title>
  <desc id="description">For the same complete ${result.offerCount}-offer task, the selected WebMCP tool and result use ${formatNumber(webmcp)} tokens, ${result.savingsPercent.selectedToolVsHtml} percent fewer than relevant HTML and ${result.savingsPercent.selectedToolVsAria} percent fewer than an ARIA snapshot.</desc>
  <style>
    :root { color-scheme: light dark; }
    .background { fill: #ffffff; }
    .heading { fill: #111827; font: 600 25px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .subheading, .note { fill: #4b5563; font: 400 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .group-title { fill: #111827; font: 600 17px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .label { fill: #374151; font: 500 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .value { fill: #111827; font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .saving { fill: #047857; font: 600 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .baseline { fill: #9ca3af; }
    .webmcp { fill: #10b981; }
    .track { fill: #e5e7eb; }
    .divider { stroke: #e5e7eb; stroke-width: 1; }
    @media (prefers-color-scheme: dark) {
      .background { fill: #0d1117; }
      .heading, .group-title, .value { fill: #f0f6fc; }
      .subheading, .note, .label { fill: #9da7b3; }
      .saving { fill: #3fb950; }
      .baseline { fill: #6e7681; }
      .webmcp { fill: #3fb950; }
      .track { fill: #21262d; }
      .divider { stroke: #30363d; }
    }
  </style>
  <rect class="background" width="960" height="410" rx="14"/>
  <text class="heading" x="42" y="47">Token footprint for the same complete task</text>
  <text class="subheading" x="42" y="73">${result.scenario} · ${result.offerCount}/${result.offerCount} offers · o200k_base · ${date}</text>
  <line class="divider" x1="480" y1="105" x2="480" y2="338"/>

  <g transform="translate(42 112)">
    <text class="group-title" x="0" y="0">Compared with relevant HTML</text>
    <text class="saving" x="0" y="34">${result.savingsPercent.selectedToolVsHtml}% fewer tokens</text>
    <text class="label" x="0" y="72">Relevant HTML</text>
    <rect class="track" x="0" y="84" width="330" height="24" rx="5"/>
    <rect class="baseline" x="0" y="84" width="330" height="24" rx="5"/>
    <text class="value" x="340" y="101">${formatNumber(html)}</text>
    <text class="label" x="0" y="139">WebMCP</text>
    <rect class="track" x="0" y="151" width="330" height="24" rx="5"/>
    <rect class="webmcp" x="0" y="151" width="${htmlWidth.toFixed(2)}" height="24" rx="5"/>
    <text class="value" x="340" y="168">${formatNumber(webmcp)}</text>
  </g>

  <g transform="translate(516 112)">
    <text class="group-title" x="0" y="0">Compared with an ARIA snapshot</text>
    <text class="saving" x="0" y="34">${result.savingsPercent.selectedToolVsAria}% fewer tokens</text>
    <text class="label" x="0" y="72">ARIA snapshot</text>
    <rect class="track" x="0" y="84" width="330" height="24" rx="5"/>
    <rect class="baseline" x="0" y="84" width="330" height="24" rx="5"/>
    <text class="value" x="340" y="101">${formatNumber(aria)}</text>
    <text class="label" x="0" y="139">WebMCP</text>
    <rect class="track" x="0" y="151" width="330" height="24" rx="5"/>
    <rect class="webmcp" x="0" y="151" width="${ariaWidth.toFixed(2)}" height="24" rx="5"/>
    <text class="value" x="340" y="168">${formatNumber(webmcp)}</text>
  </g>

  <line class="divider" x1="42" y1="350" x2="918" y2="350"/>
  <text class="note" x="42" y="380">WebMCP payload = selected query descriptor + input + complete structured result. Lower is better.</text>
</svg>
`;
}

async function writeOutput(path, content) {
  const destination = resolve(process.cwd(), path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

function fixtureHtml(totalOffers = 24) {
  const offer = (index) => {
    const seller = index === 0 ? 'Amazon' : `Fixture Händler ${String(index).padStart(2, '0')}`;
    const price = `${16 + Math.floor(index / 3)},${String((index * 17) % 100).padStart(2, '0')} €`;
    const id = index === 0 ? 'pinned-offer' : `offer-${index}`;
    return `
      <article id="${id}" class="${index === 0 ? 'pinned-offer' : 'offer'}" data-offer-index="${index}">
        <div class="offer-summary">
          <h3>Hitster Summer Party – neues Exemplar</h3>
          <p class="condition">Zustand: Neu. Originalverpackt und sofort lieferbar.</p>
          <div class="merchant">
            <span class="merchant-label">Verkauf durch</span>
            <strong data-webmcp-field="seller">${seller}</strong>
            <span class="rating">Bewertung: 97 % positiv aus 1.248 Bewertungen</span>
          </div>
          <div class="pricing">
            <span class="price" data-webmcp-field="price">${price}</span>
            <span class="shipping">Kostenlose Lieferung innerhalb Deutschlands</span>
            <span class="tax">Preis inklusive Mehrwertsteuer</span>
          </div>
          <form action="/cart/add" method="post">
            <input type="hidden" name="offer" value="${index}">
            <input type="submit" aria-label="In den Einkaufswagen vom Verkäufer ${seller} und Preis ${price}" value="In den Einkaufswagen">
          </form>
        </div>
      </article>`;
  };
  const initial = Array.from({ length: 8 }, (_, index) => offer(index));
  const remaining = Array.from({ length: totalOffers - 8 }, (_, index) => offer(index + 8));
  return `<!doctype html>
    <html lang="de">
      <head>
        <style>
          #all-offers-display-scroller { height: 420px; overflow: auto; }
          article { min-height: 180px; border-bottom: 1px solid #ddd; padding: 12px; }
        </style>
      </head>
      <body>
        <section id="all-offers-display" role="dialog" aria-label="Gesamtangebots-Ansicht">
          <header><h2>${totalOffers - 1} weitere Optionen</h2></header>
          <div id="all-offers-display-scroller">
            <div id="pinned-offer-container">${initial[0]}</div>
            <div id="offer-list" aria-label="Weitere Angebote">${initial.slice(1).join('')}</div>
          </div>
        </section>
        <script>
          const remainingOffers = ${JSON.stringify(remaining)};
          const scroller = document.querySelector('#all-offers-display-scroller');
          const list = document.querySelector('#offer-list');
          let loading = false;
          scroller.addEventListener('scroll', () => {
            if (loading || remainingOffers.length === 0) return;
            if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 24) return;
            loading = true;
            setTimeout(() => {
              list.insertAdjacentHTML('beforeend', remainingOffers.splice(0, 4).join(''));
              loading = false;
            }, 20);
          });
        </script>
      </body>
    </html>`;
}

async function openFixture(page) {
  await page.setContent(fixtureHtml());
  return {
    scenario: 'controlled-24-offer-fixture',
    target: page.locator('#all-offers-display'),
  };
}

async function openAmazon(page) {
  const asin = argument('--asin') ?? process.env.WEBMCP_AMAZON_ASIN ?? 'B0CXDLJTY3';
  const url = argument('--url')
    ?? `https://www.amazon.de/dp/${asin}/ref=olp-opf-redir?aod=1&ie=UTF8&condition=ALL`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: /Gesamtangebots-Ansicht|All Offers Display/i });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  if (!await dialog.isVisible()) {
    const offersLink = page.locator('#aod-ingress-link');
    await offersLink.waitFor({ state: 'visible', timeout: 15_000 });
    await offersLink.click();
  }
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return {
    scenario: `live-amazon-de-${asin}`,
    target: dialog,
  };
}

async function benchmark(mode) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const opened = mode === 'live' ? await openAmazon(page) : await openFixture(page);
    await page.addScriptTag({ path: browserBundle });
    const webmcp = await page.evaluate(async () => {
      const registrations = new Map();
      const platformEvents = [];
      const adapter = {
        isAvailable: () => true,
        registerTool: (tool) => {
          registrations.set(tool.name, tool);
          platformEvents.push({ type: 'register', name: tool.name });
          return { name: tool.name };
        },
        unregisterTool: (name) => {
          registrations.delete(name);
          platformEvents.push({ type: 'unregister', name });
        },
      };
      const runtimeStartedAt = globalThis.performance.now();
      const runtime = globalThis.AgentReadyWebMCP.createWebMCPRuntime({
        mode: 'auto',
        adapter,
        autoStart: true,
        observe: false,
        discovery: { repeatedLists: { settleMs: 100 } },
      });
      const initialDiscoveryDurationMs = Math.round(
        (globalThis.performance.now() - runtimeStartedAt) * 1_000,
      ) / 1_000;
      const catalog = runtime.listTools();
      const initialRegistrationCount = platformEvents.length;
      const query = catalog.find((tool) => (
        tool.kind === 'query'
        && tool.metadata?.recordScope === 'accessible-offers'
      ));
      if (!query) {
        runtime.destroy();
        throw new Error('No aggregate accessible-offers query was discovered.');
      }
      const input = {};
      const invocationStartedAt = globalThis.performance.now();
      const result = await runtime.invokeTool(query.name, input);
      const invocationDurationMs = Math.round(
        (globalThis.performance.now() - invocationStartedAt) * 1_000,
      ) / 1_000;
      const refreshes = [];
      for (let index = 0; index < 5; index += 1) {
        const eventStart = platformEvents.length;
        const startedAt = globalThis.performance.now();
        const refreshedCatalog = runtime.refresh();
        const events = platformEvents.slice(eventStart);
        refreshes.push({
          index,
          durationMs: Math.round((globalThis.performance.now() - startedAt) * 1_000) / 1_000,
          catalogToolCount: refreshedCatalog.length,
          registrations: events.filter((event) => event.type === 'register').length,
          unregistrations: events.filter((event) => event.type === 'unregister').length,
        });
      }
      const registrationMetrics = {
        initialRegistrations: initialRegistrationCount,
        activeRegistrations: registrations.size,
        refreshes,
        totalRegistrations: platformEvents.filter((event) => event.type === 'register').length,
        totalUnregistrations: platformEvents.filter((event) => event.type === 'unregister').length,
        stableRefreshes: {
          count: refreshes.slice(1).length,
          actualPlatformOperations: refreshes.slice(1).reduce(
            (total, refresh) => total + refresh.registrations + refresh.unregistrations,
            0,
          ),
          naivePlatformOperations: refreshes.slice(1).reduce(
            (total, refresh) => total + refresh.catalogToolCount * 2,
            0,
          ),
          averageDurationMs: Math.round(
            refreshes.slice(1).reduce((total, refresh) => total + refresh.durationMs, 0)
              / Math.max(1, refreshes.slice(1).length)
              * 1_000,
          ) / 1_000,
        },
      };
      runtime.destroy();
      return {
        catalog,
        query,
        input,
        result,
        registrationMetrics,
        timings: { initialDiscoveryDurationMs, invocationDurationMs },
      };
    });

    const completeness = webmcp.result?.completeness;
    if (
      webmcp.result?.status !== 'ok'
      || completeness?.complete !== true
      || completeness.expectedCount !== completeness.collectedCount
    ) {
      throw new Error(`Incomplete benchmark result: ${JSON.stringify(completeness)}`);
    }

    const regionHtml = await opened.target.evaluate((element) => element.outerHTML);
    const ariaSnapshot = await opened.target.ariaSnapshot();
    const metrics = {
      relevantHtml: measurement('Relevant region HTML', regionHtml),
      ariaSnapshot: measurement('Relevant region ARIA snapshot', ariaSnapshot),
      webmcpResult: measurement('WebMCP result only (warm)', webmcp.result),
      webmcpSelected: measurement('Selected tool + input + result', {
        tool: webmcp.query,
        input: webmcp.input,
        result: webmcp.result,
      }),
      webmcpCold: measurement('Full catalog + input + result (cold)', {
        catalog: webmcp.catalog,
        invocation: { name: webmcp.query.name, input: webmcp.input },
        result: webmcp.result,
      }),
    };
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      scenario: opened.scenario,
      tokenizer: tokenizerName,
      methodology: {
        scope: 'The complete offers region after lazy loading; task prompt and model output are excluded equally.',
        serialization: 'Minified JSON for WebMCP payloads; literal HTML and Playwright ARIA YAML for baselines.',
      },
      offerCount: completeness.collectedCount,
      completeness,
      catalogToolCount: webmcp.catalog.length,
      registrationMetrics: webmcp.registrationMetrics,
      timings: webmcp.timings,
      metrics,
      savingsPercent: {
        warmResultVsHtml: savings(metrics.relevantHtml, metrics.webmcpResult),
        selectedToolVsHtml: savings(metrics.relevantHtml, metrics.webmcpSelected),
        coldCatalogVsHtml: savings(metrics.relevantHtml, metrics.webmcpCold),
        warmResultVsAria: savings(metrics.ariaSnapshot, metrics.webmcpResult),
        selectedToolVsAria: savings(metrics.ariaSnapshot, metrics.webmcpSelected),
        coldCatalogVsAria: savings(metrics.ariaSnapshot, metrics.webmcpCold),
      },
      amortization: {
        methodology: 'First task includes the full catalog; later tasks reuse it and include only the structured result.',
        breakEvenTasksVsHtml: cachedBreakEvenTasks(
          metrics.relevantHtml,
          metrics.webmcpCold,
          metrics.webmcpResult,
        ),
        breakEvenTasksVsAria: cachedBreakEvenTasks(
          metrics.ariaSnapshot,
          metrics.webmcpCold,
          metrics.webmcpResult,
        ),
      },
    };
  } finally {
    await browser.close();
  }
}

const mode = process.argv.includes('--live') ? 'live' : 'fixture';
const result = await benchmark(mode);
const outputPath = argument('--output');
const chartPath = argument('--chart');
if (outputPath) await writeOutput(outputPath, `${JSON.stringify(result, null, 2)}\n`);
if (chartPath) await writeOutput(chartPath, tokenSavingsChart(result));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
