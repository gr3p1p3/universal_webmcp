import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const browserBundle = fileURLToPath(new URL('../../dist/browser.iife.js', import.meta.url));

async function loadRuntime(page: Page): Promise<void> {
  await page.addScriptTag({ path: browserBundle });
  await expect.poll(() => page.evaluate(() => typeof window.AgentReadyWebMCP)).toBe('object');
}

test.beforeEach(async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <body>
        <button id="save" data-webmcp-tool="save-item">Save</button>
        <form aria-label="Search">
          <label>Query <input name="query" type="search"></label>
          <button type="submit">Search</button>
        </form>
        <ul aria-label="Results"><li>Alpha</li><li>Beta</li></ul>
      </body>
    </html>
  `);
  await loadRuntime(page);
});

test('discovers page capabilities and exposes handler-free descriptors', async ({ page }) => {
  const snapshot = await page.evaluate(() => {
    const runtime = window.AgentReadyWebMCP.createWebMCPRuntime({
      mode: 'auto',
      autoStart: true,
      observe: false,
    });
    const tools = runtime.listTools();
    const result = {
      running: runtime.isRunning(),
      names: tools.map((tool) => tool.name),
      kinds: tools.map((tool) => tool.kind),
      leaksHandler: tools.some((tool) => 'handler' in tool),
    };
    runtime.destroy();
    return result;
  });

  expect(snapshot.running).toBe(true);
  expect(snapshot.names).toContain('save-item');
  expect(snapshot.kinds).toContain('query');
  expect(snapshot.kinds).toContain('form');
  expect(snapshot.leaksHandler).toBe(false);
});

test('invokes a read-only discovered list in a real browser', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const runtime = window.AgentReadyWebMCP.createWebMCPRuntime({
      mode: 'auto',
      autoStart: true,
      observe: false,
    });
    const query = runtime.listTools().find((tool) => tool.kind === 'query');
    if (!query) throw new Error('Expected a discovered query tool.');
    const value = await runtime.invokeTool(query.name, {});
    runtime.destroy();
    return value;
  });

  expect(result).toEqual({
    status: 'ok',
    items: ['Alpha', 'Beta'],
    completeness: {
      expectedCount: null,
      collectedCount: 2,
      complete: true,
      source: 'scroll-exhausted',
      iterations: 0,
    },
  });
});

test('tracks controls added and removed from a dynamic DOM', async ({ page }) => {
  await page.evaluate(() => {
    window.webmcpE2ERuntime = window.AgentReadyWebMCP.createWebMCPRuntime({
      mode: 'auto',
      autoStart: true,
      observerOptions: { debounceMs: 0 },
    });
  });

  await page.evaluate(() => {
    const button = document.createElement('button');
    button.dataset.webmcpTool = 'dynamic-action';
    button.textContent = 'Dynamic action';
    document.body.append(button);
  });
  await expect.poll(() => page.evaluate(() => (
    window.webmcpE2ERuntime?.listTools().some((tool) => tool.name === 'dynamic-action')
  ))).toBe(true);

  await page.locator('[data-webmcp-tool="dynamic-action"]').evaluate((element) => element.remove());
  await expect.poll(() => page.evaluate(() => (
    window.webmcpE2ERuntime?.listTools().some((tool) => tool.name === 'dynamic-action')
  ))).toBe(false);

  await page.evaluate(() => window.webmcpE2ERuntime?.destroy());
});

test('blocks inferred mutations when no confirmation channel exists', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const runtime = window.AgentReadyWebMCP.createWebMCPRuntime({
      mode: 'auto',
      autoStart: true,
      observe: false,
      confirmationPolicy: 'never',
    });
    const value = await runtime.invokeTool('save-item', {});
    runtime.destroy();
    return value;
  });

  expect(result).toMatchObject({ status: 'blocked', code: 'tool-denied' });
});

test('groups repeated item actions and returns after the resulting UI synchronizes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.body.innerHTML = `
      <ul aria-label="Products">
        <li>Alpha <button>Add to cart</button></li>
        <li>Beta <button>Add to cart</button></li>
      </ul>`;
    document.querySelectorAll('button')[1]?.addEventListener('click', () => {
      setTimeout(() => {
        const status = document.createElement('output');
        status.dataset.webmcpTool = 'cart-updated';
        status.dataset.webmcpAction = 'click';
        status.textContent = 'Cart updated';
        document.body.append(status);
      }, 20);
    });
    const adapter = {
      isAvailable: () => false,
      registerTool: (tool: { name: string }) => ({ name: tool.name }),
      unregisterTool: () => undefined,
      requestUserInteraction: async () => ({ confirmed: true }),
    };
    const runtime = window.AgentReadyWebMCP.createWebMCPRuntime({
      mode: 'auto',
      adapter,
      autoStart: true,
      observerOptions: { debounceMs: 0 },
      synchronization: { settleMs: 50, timeoutMs: 500 },
    });
    const grouped = runtime.listTools().find(
      (tool) => tool.metadata?.discovery === 'repeated-item-action',
    );
    const invocation = grouped
      ? await runtime.invokeTool(grouped.name, { index: 1 })
      : { status: 'error', error: 'grouped-tool-not-found' };
    const snapshot = {
      groupedName: grouped?.name,
      invocation,
      synchronized: runtime.listTools().some((tool) => tool.name === 'cart-updated'),
    };
    runtime.destroy();
    return snapshot;
  });

  expect(result).toMatchObject({
    groupedName: 'item.add-to-cart.products',
    invocation: { status: 'ok', action: 'click' },
    synchronized: true,
  });
});
