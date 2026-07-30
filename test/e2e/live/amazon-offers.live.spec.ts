import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const browserBundle = fileURLToPath(new URL('../../../dist/browser.iife.js', import.meta.url));
const asin = process.env.WEBMCP_AMAZON_ASIN ?? 'B0CXDLJTY3';
const amazonUrl = `https://www.amazon.de/dp/${asin}/ref=olp-opf-redir?aod=1&ie=UTF8&condition=ALL`;

test('catalogs every lazy-loaded Amazon seller price, not only the Buy Box', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(amazonUrl, { waitUntil: 'domcontentloaded' });

  const offersDialog = page.getByRole('dialog', { name: /Gesamtangebots-Ansicht|All Offers Display/i });
  await offersDialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  if (!await offersDialog.isVisible()) {
    const offersLink = page.locator('#aod-ingress-link');
    await expect(offersLink).toBeVisible();
    await offersLink.click();
  }
  await expect(offersDialog).toBeVisible({ timeout: 15_000 });
  const optionsHeading = offersDialog.getByRole('heading', { name: /weitere Optionen|other options/i });
  const optionsText = await optionsHeading.innerText();
  const additionalOffers = Number.parseInt(optionsText, 10);
  expect(additionalOffers).toBeGreaterThan(0);
  const expectedOfferCount = additionalOffers + 1;

  await page.addScriptTag({ path: browserBundle });
  const audit = await page.evaluate(async () => {
    const runtime = window.AgentReadyWebMCP.createWebMCPRuntime({
      mode: 'auto',
      autoStart: true,
      observe: false,
    });
    const catalog = runtime.listTools();
    const repeatedQueries = catalog.filter((tool) => (
      tool.kind === 'query'
      && tool.metadata?.discovery === 'repeated-list'
    ));
    const query = repeatedQueries.find((tool) => (
      tool.metadata?.structured === true
      && /offer|angebot/i.test(`${tool.name} ${tool.description} ${tool.targetUI?.selector ?? ''}`)
    ));
    const result = query ? await runtime.invokeTool(query.name, {}) : null;
    runtime.destroy();
    return {
      queryFound: !!query,
      repeatedQueries: repeatedQueries.map((tool) => ({
        name: tool.name,
        selector: tool.targetUI?.selector,
        structured: tool.metadata?.structured,
      })),
      result,
    };
  });

  expect(audit.queryFound, JSON.stringify(audit.repeatedQueries, null, 2)).toBe(true);
  expect(audit.result, JSON.stringify(audit.repeatedQueries, null, 2)).toMatchObject({
    status: 'ok',
    completeness: {
      expectedCount: expectedOfferCount,
      collectedCount: expectedOfferCount,
      complete: true,
      source: 'heading',
    },
  });
  expect((audit.result as { items: unknown[] }).items).toHaveLength(expectedOfferCount);
  expect((audit.result as { items: Array<{ fields?: { seller?: string; price?: string } }> }).items.every(
    (item) => typeof item.fields?.seller === 'string' && typeof item.fields?.price === 'string',
  )).toBe(true);
});
