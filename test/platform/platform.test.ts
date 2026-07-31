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

  it('adapts RuntimeTool to the current WebMCP contract and unregisters through AbortSignal', async () => {
    const bridge = {
      registerTool: vi.fn(async (
        nativeTool: { execute(input: object): Promise<unknown> },
        registrationOptions: { signal: AbortSignal; exposedTo?: readonly string[] },
      ) => {
        void nativeTool;
        void registrationOptions;
      }),
    };
    const adapter = new BrowserModelContextAdapter(bridge, { exposedTo: ['https://agent.example'] });
    expect(adapter.isAvailable()).toBe(true);
    const registration = adapter.registerTool(tool);
    expect(registration.name).toBe('example');
    await expect(registration.ready).resolves.toBeUndefined();
    const [native, options] = bridge.registerTool.mock.calls[0]!;
    expect(native).toMatchObject({
      name: 'example',
      description: 'example',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(native).not.toHaveProperty('handler');
    await expect(native.execute({})).resolves.toBeNull();
    await expect(native.execute([])).rejects.toThrow(TypeError);
    expect(options.exposedTo).toEqual(['https://agent.example']);
    expect(options.signal.aborted).toBe(false);
    adapter.unregisterTool('example');
    expect(options.signal.aborted).toBe(true);
  });

  it('accepts the standard bridge without a non-standard unregisterTool method', () => {
    const adapter = new BrowserModelContextAdapter({ registerTool: vi.fn(async () => undefined) });
    expect(adapter.isAvailable()).toBe(true);
  });

  it('propagates asynchronous platform registration failures', async () => {
    const adapter = new BrowserModelContextAdapter({
      registerTool: vi.fn(async () => { throw new DOMException('duplicate', 'InvalidStateError'); }),
    });
    await expect(adapter.registerTool(tool).ready).rejects.toMatchObject({ name: 'InvalidStateError' });
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
