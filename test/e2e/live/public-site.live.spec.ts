import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const browserBundle = fileURLToPath(new URL('../../../dist/browser.iife.js', import.meta.url));
const liveUrl = process.env.WEBMCP_LIVE_URL ?? 'https://www.wikipedia.org/';

async function openLivePageWithRuntime(page: Page): Promise<void> {
  const response = await page.goto(liveUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'The live site did not return a main-document response.').not.toBeNull();
  expect(response?.status(), 'The live site returned an HTTP error.').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await page.addScriptTag({ path: browserBundle });
  await expect.poll(() => page.evaluate(() => typeof window.AgentReadyWebMCP)).toBe('object');
}

test('discovers a useful, policy-evaluable tool surface on a public site', async ({ page }) => {
  await openLivePageWithRuntime(page);

  const audit = await page.evaluate(() => {
    const runtime = window.AgentReadyWebMCP.createWebMCPRuntime({
      mode: 'auto',
      autoStart: true,
      observe: false,
    });
    const tools = runtime.listTools();
    const decisions = tools.map((tool) => runtime.getPolicyDecision(tool.name)?.decision);
    const result = {
      count: tools.length,
      uniqueNames: new Set(tools.map((tool) => tool.name)).size,
      kinds: [...new Set(tools.map((tool) => tool.kind))],
      sources: [...new Set(tools.map((tool) => tool.provenance.source))],
      decisions,
      leaksHandler: tools.some((tool) => 'handler' in tool),
      runningBeforeStop: runtime.isRunning(),
    };
    runtime.stop();
    return {
      ...result,
      runningAfterStop: runtime.isRunning(),
      toolsAfterStop: runtime.listTools().length,
    };
  });

  expect(audit.count).toBeGreaterThan(10);
  expect(audit.uniqueNames).toBe(audit.count);
  expect(audit.kinds).toContain('navigation');
  expect(audit.kinds).toContain('form');
  expect(audit.sources.every((source) => source === 'discovery' || source === 'metadata')).toBe(true);
  expect(audit.decisions.every((decision) => decision !== undefined)).toBe(true);
  expect(audit.leaksHandler).toBe(false);
  expect(audit.runningBeforeStop).toBe(true);
  expect(audit.runningAfterStop).toBe(false);
  expect(audit.toolsAfterStop).toBe(0);
});

test('can safely invoke a read-only list discovered on the live page', async ({ page }) => {
  await openLivePageWithRuntime(page);

  const invocation = await page.evaluate(async () => {
    const runtime = window.AgentReadyWebMCP.createWebMCPRuntime({
      mode: 'auto',
      autoStart: true,
      observe: false,
    });
    const query = runtime.listTools().find((tool) => tool.kind === 'query');
    if (!query) {
      runtime.destroy();
      return { found: false as const };
    }
    const result = await runtime.invokeTool(query.name, {});
    runtime.destroy();
    return { found: true as const, result };
  });

  expect(invocation.found, 'The page no longer exposes a discoverable repeated list.').toBe(true);
  if (invocation.found) {
    expect(invocation.result).toMatchObject({ status: 'ok' });
    expect((invocation.result as { items?: unknown[] }).items?.length).toBeGreaterThan(1);
  }
});
