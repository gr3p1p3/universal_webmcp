import { describe, expect, it, vi } from 'vitest';
import { BrowserModelContextAdapter, getModelContext, MockModelContextAdapter } from '../../src/platform/index.js';
import type { RuntimeTool } from '../../src/core/model.js';

const tool: RuntimeTool = {
  name: 'example', description: 'example', kind: 'query', inputSchema: { type: 'object' },
  risk: { level: 'low' }, provenance: { source: 'explicit', confidence: 1 }, handler: () => null,
};

describe('model context platform boundary', () => {
  it('returns null outside a verified browser context', () => {
    expect(getModelContext()).toBeNull();
  });

  it('adapts only verified bridge methods and returns a stable handle', () => {
    const bridge = { registerTool: vi.fn(() => ({ registrationId: 'r1' })), unregisterTool: vi.fn() };
    const adapter = new BrowserModelContextAdapter(bridge);
    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.registerTool(tool)).toEqual({ name: 'example', registrationId: 'r1' });
    adapter.unregisterTool('example');
    expect(bridge.unregisterTool).toHaveBeenCalledWith('example');
  });

  it('supports mock registration and user interaction for tests', async () => {
    const adapter = new MockModelContextAdapter();
    expect(adapter.registerTool(tool).name).toBe('example');
    await expect(adapter.requestUserInteraction({ message: 'Confirm?' })).resolves.toEqual({ confirmed: true });
    expect(adapter.interactions).toHaveLength(1);
    adapter.unregisterTool('example');
    expect(adapter.registeredTools()).toHaveLength(0);
  });
});
