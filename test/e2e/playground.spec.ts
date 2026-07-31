import { expect, test } from '@playwright/test';

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
];

test('playground proves tools are exposed only while the runtime is active', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Runtime running · hybrid', { exact: true })).toBeVisible();
  await expect(page.locator('[data-webmcp-ignore] #add-mapping')).toBeVisible();
  await expect(page.locator('[data-webmcp-ignore] #run-all')).toBeVisible();
  await expect(page.locator('#agent-tool-count')).toHaveText(String(expectedApplicationToolNames.length));

  await page.getByRole('button', { name: 'Run live registration proof' }).click();

  await expect(page.locator('#proof-before')).toHaveText('0');
  await expect(page.locator('#proof-after')).toHaveText('0');
  await expect(page.locator('#proof-active')).toHaveText(String(expectedApplicationToolNames.length));

  const proof = JSON.parse(await page.locator('#registration-proof').textContent() ?? '{}') as {
    runtimeStopped?: number;
    runtimeActive?: Array<{
      name?: string;
      description?: string;
      inputSchema?: { type?: string };
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    }>;
    runtimeStoppedAgain?: number;
  };
  expect(proof.runtimeStopped).toBe(0);
  expect(proof.runtimeStoppedAgain).toBe(0);
  expect(proof.runtimeActive?.map((tool) => tool.name)).toEqual(expectedApplicationToolNames);
  expect(proof.runtimeActive?.some((tool) => tool.name?.startsWith('qa.'))).toBe(false);
  expect(proof.runtimeActive?.every((tool) => (
    typeof tool.description === 'string'
    && tool.inputSchema?.type === 'object'
    && typeof tool.annotations?.readOnlyHint === 'boolean'
    && typeof tool.annotations?.untrustedContentHint === 'boolean'
  ))).toBe(true);

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('#agent-tool-count')).toHaveText('0');
  await expect(page.locator('#agent-tool-list')).toContainText('No tools are registered');

  await page.getByRole('button', { name: 'Start runtime', exact: true }).click();
  await expect(page.locator('#agent-tool-count')).toHaveText(String(expectedApplicationToolNames.length));

  await page.getByRole('button', { name: 'Run all checks', exact: true }).click();
  await expect(page.locator('#suite-status')).toHaveText('all pass');
  await expect(page.locator('#fail-count')).toHaveText('0');
});
