import { describe, expect, it, vi } from 'vitest';
import {
  createEventInvalidationSource,
  createWebMCPRuntime,
  RuntimeDestroyedError,
  type ModelContextAdapter,
  type RuntimeTool,
  type UserInteractionRequest,
  type UserInteractionResult,
} from '../../src/index.js';

function tool(name: string, source: RuntimeTool['provenance']['source'] = 'explicit', kind: RuntimeTool['kind'] = 'query', handler: RuntimeTool['handler'] = () => ({ status: 'ok' })): RuntimeTool {
  return {
    name, description: name, kind, inputSchema: { type: 'object' }, risk: { level: 'low' },
    provenance: { source, confidence: 1 }, handler,
  };
}

class CaptureAdapter implements ModelContextAdapter {
  public readonly tools = new Map<string, RuntimeTool>();
  public readonly interactions: UserInteractionRequest[] = [];
  public readonly registrations: string[] = [];
  public readonly unregistrations: string[] = [];
  public available = true;
  public rejectRegistration = false;
  public unregistrationFailures = 0;
  public result: UserInteractionResult = { confirmed: true };
  isAvailable(): boolean { return this.available; }
  registerTool(value: RuntimeTool): { name: string; ready?: PromiseLike<void> } {
    if (this.rejectRegistration) {
      return { name: value.name, ready: Promise.reject(new Error('registration rejected')) };
    }
    this.registrations.push(value.name);
    this.tools.set(value.name, value);
    return { name: value.name };
  }
  unregisterTool(name: string): void {
    this.unregistrations.push(name);
    if (this.unregistrationFailures > 0) {
      this.unregistrationFailures -= 1;
      throw new Error('unregistration failed');
    }
    this.tools.delete(name);
  }
  async requestUserInteraction(request: UserInteractionRequest): Promise<UserInteractionResult> { this.interactions.push(request); return this.result; }
}

describe('createWebMCPRuntime', () => {
  it('defaults to hybrid and has an idempotent lifecycle', () => {
    const adapter = new CaptureAdapter();
    const runtime = createWebMCPRuntime({ adapter, initialTools: [tool('explicit.tool')] });
    expect(runtime.mode).toBe('hybrid');
    runtime.start();
    runtime.start();
    expect(adapter.tools.size).toBe(1);
    expect(runtime.isRunning()).toBe(true);
    runtime.stop();
    runtime.stop();
    expect(adapter.tools.size).toBe(0);
    expect(runtime.isRunning()).toBe(false);
  });

  it.each(['explicit', 'adapter', 'auto', 'hybrid'] as const)('supports %s mode', (mode) => {
    document.body.innerHTML = '<button data-webmcp-tool="save">Save</button>';
    const adapter = new CaptureAdapter();
    const runtime = createWebMCPRuntime({ mode, adapter, initialTools: [tool('explicit.tool'), tool('adapter.tool', 'adapter')] });
    runtime.start();
    const names = runtime.listTools().map((item) => item.name);
    if (mode === 'explicit') expect([...adapter.tools.keys()]).toEqual(['explicit.tool']);
    if (mode === 'adapter') expect([...adapter.tools.keys()]).toEqual(['adapter.tool']);
    if (mode === 'auto') expect(names).toContain('save');
    if (mode === 'hybrid') expect([...adapter.tools.keys()]).toEqual(['explicit.tool', 'adapter.tool', 'save']);
  });

  it('works locally when the platform is unavailable', () => {
    document.body.innerHTML = '<button data-webmcp-tool="save">Save</button>';
    const adapter = new CaptureAdapter();
    adapter.available = false;
    const runtime = createWebMCPRuntime({ adapter });
    runtime.start();
    expect(runtime.listTools().map((item) => item.name)).toContain('save');
    expect(runtime.diagnostics.some((item) => item.code === 'platform-unavailable')).toBe(true);
  });

  it('reports asynchronous platform registration failures without retaining stale state', async () => {
    const adapter = new CaptureAdapter();
    adapter.rejectRegistration = true;
    const runtime = createWebMCPRuntime({ adapter, initialTools: [tool('async.failure')] });
    runtime.start();
    await vi.waitFor(() => {
      expect(runtime.diagnostics).toContainEqual(expect.objectContaining({
        code: 'platform-registration-failed',
        toolName: 'async.failure',
      }));
    });
    runtime.stop();
  });

  it('keeps explicit tools ahead of discovery with the same name', () => {
    document.body.innerHTML = '<button data-webmcp-tool="save">Save</button>';
    const handler = vi.fn(() => ({ explicit: true }));
    const runtime = createWebMCPRuntime({ initialTools: [tool('save', 'explicit', 'action', handler)] });
    runtime.start();
    expect(runtime.listTools()).toHaveLength(1);
    expect(runtime.listTools()[0]?.provenance.source).toBe('explicit');
  });

  it('does not invoke a denied wrapper', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const adapter = new CaptureAdapter();
    const runtime = createWebMCPRuntime({ mode: 'explicit', adapter, initialTools: [tool('blocked', 'discovery', 'action', handler)] });
    runtime.start();
    expect(adapter.tools.has('blocked')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('exposes descriptors and routes local invocation through policy', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const runtime = createWebMCPRuntime({ mode: 'explicit', initialTools: [tool('blocked.local', 'discovery', 'action', handler), tool('allowed.local', 'explicit', 'query', handler)] });
    const descriptors = runtime.listTools();
    expect(descriptors[0]).not.toHaveProperty('handler');
    expect(runtime).not.toHaveProperty('registry');
    expect(runtime.registerTool(tool('returned.descriptor'))).not.toHaveProperty('handler');
    await expect(runtime.invokeTool('blocked.local', {})).resolves.toMatchObject({ status: 'blocked', code: 'tool-denied' });
    await expect(runtime.invokeTool('allowed.local', {})).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation at call time and blocks a rejected call', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const adapter = new CaptureAdapter();
    adapter.result = { confirmed: false };
    const runtime = createWebMCPRuntime({ adapter, initialTools: [tool('mutate', 'discovery', 'action', handler)] });
    runtime.start();
    const registered = adapter.tools.get('mutate');
    expect(registered).toBeDefined();
    expect(adapter.interactions).toHaveLength(0);
    await expect(registered?.handler({})).resolves.toMatchObject({ status: 'blocked', code: 'confirmation-rejected' });
    expect(adapter.interactions).toHaveLength(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes all platform registrations on stop and destroys local state', () => {
    const adapter = new CaptureAdapter();
    const runtime = createWebMCPRuntime({ adapter, initialTools: [tool('one'), tool('two')] });
    runtime.start();
    runtime.destroy();
    runtime.destroy();
    expect(adapter.tools.size).toBe(0);
    expect(runtime.listTools()).toHaveLength(0);
    expect(runtime.isRunning()).toBe(false);
  });

  it('retains failed removals so a later stop can retry them', () => {
    const adapter = new CaptureAdapter();
    adapter.unregistrationFailures = 1;
    const runtime = createWebMCPRuntime({
      mode: 'explicit',
      adapter,
      initialTools: [tool('retry.removal')],
    });
    runtime.start();
    runtime.stop();
    expect(adapter.tools.has('retry.removal')).toBe(true);
    expect(runtime.diagnostics).toContainEqual(expect.objectContaining({
      code: 'platform-unregistration-failed',
      toolName: 'retry.removal',
    }));
    runtime.stop();
    expect(adapter.tools.has('retry.removal')).toBe(false);
    expect(adapter.unregistrations).toEqual(['retry.removal', 'retry.removal']);
  });

  it('resynchronizes dynamically added and removed discovery tools', async () => {
    document.body.innerHTML = '<button data-webmcp-tool="first">First</button>';
    const adapter = new CaptureAdapter();
    const runtime = createWebMCPRuntime({ adapter, observerOptions: { debounceMs: 0 } });
    runtime.start();
    expect(runtime.listTools().map((item) => item.name)).toContain('first');
    document.body.insertAdjacentHTML('beforeend', '<button data-webmcp-tool="second">Second</button>');
    await vi.waitFor(() => expect(runtime.listTools().map((item) => item.name)).toContain('second'));
    const first = document.querySelector('[data-webmcp-tool="first"]');
    first?.remove();
    await vi.waitFor(() => expect(runtime.listTools().map((item) => item.name)).not.toContain('first'));
    expect(adapter.tools.has('first')).toBe(false);
    runtime.stop();
  });

  it('resynchronizes text and style changes that alter semantic discovery', async () => {
    document.body.innerHTML = '<button id="dynamic-label">Before</button>';
    const runtime = createWebMCPRuntime({ observerOptions: { debounceMs: 0 } });
    runtime.start();
    expect(runtime.listTools().map((item) => item.name)).toContain('click.dynamic-label');
    document.querySelector('#dynamic-label')!.textContent = 'After';
    await vi.waitFor(() => expect(
      runtime.listTools().find((item) => item.name === 'click.dynamic-label')?.targetUI?.label,
    ).toBe('After'));
    document.querySelector('#dynamic-label')?.setAttribute('style', 'display: none');
    await vi.waitFor(() => expect(runtime.listTools().map((item) => item.name)).not.toContain('click.dynamic-label'));
    runtime.stop();
  });

  it('supports explicit refresh and waits for a named tool', async () => {
    document.body.innerHTML = '<button data-webmcp-tool="old">Old</button>';
    const runtime = createWebMCPRuntime({ observe: false });
    runtime.start();
    document.body.innerHTML = '<button data-webmcp-tool="new">New</button>';
    expect(runtime.listTools().map((item) => item.name)).toContain('old');
    const refreshed = runtime.refresh();
    expect(refreshed.map((item) => item.name)).toContain('new');
    expect(refreshed.map((item) => item.name)).not.toContain('old');
    await expect(runtime.waitForTool('new', { timeoutMs: 20 })).resolves.toMatchObject({ name: 'new' });
    await expect(runtime.waitForTool('missing', { timeoutMs: 20 })).resolves.toBeUndefined();
    runtime.stop();
  });

  it('exposes the latest semantic catalog decision graph', () => {
    document.body.innerHTML = `
      <form id="lookup"><input name="query"><button type="submit">Go</button></form>`;
    const runtime = createWebMCPRuntime({ observe: false });
    expect(runtime.getSemanticGraph()).toBeUndefined();
    runtime.start();
    expect(runtime.getSemanticGraph()).toMatchObject({
      selectedToolNames: ['submit.lookup'],
    });
    expect(runtime.getSemanticGraph()?.nodes.some(
      (node) => node.exclusionReason === 'dominated',
    )).toBe(true);
    runtime.stop();
  });

  it('does not churn unchanged automatic platform registrations', () => {
    document.body.innerHTML = '<button data-webmcp-tool="stable">Stable</button>';
    const adapter = new CaptureAdapter();
    const runtime = createWebMCPRuntime({ adapter, observe: false });
    runtime.start();
    expect(adapter.registrations.filter((name) => name === 'stable')).toHaveLength(1);

    runtime.refresh();
    runtime.refresh();

    expect(adapter.registrations.filter((name) => name === 'stable')).toHaveLength(1);
    expect(adapter.unregistrations).not.toContain('stable');
    runtime.stop();
  });

  it('re-registers an automatic tool only when its descriptor changes', () => {
    document.body.innerHTML = '<button data-webmcp-tool="stable">Before</button>';
    const adapter = new CaptureAdapter();
    const runtime = createWebMCPRuntime({ adapter, observe: false });
    runtime.start();

    document.querySelector('button')!.textContent = 'After';
    runtime.refresh();

    expect(adapter.registrations.filter((name) => name === 'stable')).toHaveLength(2);
    expect(adapter.unregistrations.filter((name) => name === 'stable')).toHaveLength(1);
    expect(adapter.tools.get('stable')?.targetUI?.label).toBe('After');
    runtime.stop();
  });

  it('scales platform writes with DOM changes instead of catalog size', () => {
    const toolCount = 200;
    document.body.innerHTML = Array.from(
      { length: toolCount },
      (_, index) => `<button data-webmcp-tool="control-${index}">Control ${index}</button>`,
    ).join('');
    const adapter = new CaptureAdapter();
    const runtime = createWebMCPRuntime({ adapter, observe: false });
    runtime.start();
    const catalogSize = runtime.listTools().length;
    expect(catalogSize).toBe(toolCount);

    adapter.registrations.length = 0;
    adapter.unregistrations.length = 0;
    for (let index = 0; index < 10; index += 1) runtime.refresh();

    expect(adapter.registrations).toHaveLength(0);
    expect(adapter.unregistrations).toHaveLength(0);
    expect(catalogSize * 10 * 2).toBe(4_000);

    document.querySelector('[data-webmcp-tool="control-73"]')!.textContent = 'Updated';
    runtime.refresh();
    expect(adapter.registrations).toEqual(['control-73']);
    expect(adapter.unregistrations).toEqual(['control-73']);

    adapter.registrations.length = 0;
    adapter.unregistrations.length = 0;
    for (let index = 0; index < 10; index += 1) {
      document.querySelector(`[data-webmcp-tool="control-${index}"]`)?.remove();
    }
    runtime.refresh();
    expect(adapter.registrations).toHaveLength(0);
    expect(adapter.unregistrations).toHaveLength(10);
    runtime.stop();
  });

  it('bridges application invalidation events when DOM observation is disabled', async () => {
    document.body.innerHTML = '';
    const runtime = createWebMCPRuntime({
      observe: false,
      invalidationSources: [createEventInvalidationSource(window, ['app:state-ready'])],
      observerOptions: { debounceMs: 0 },
    });
    runtime.start();
    document.body.innerHTML = '<button data-webmcp-tool="from-store">Store action</button>';
    expect(runtime.listTools().map((item) => item.name)).not.toContain('from-store');
    window.dispatchEvent(new Event('app:state-ready'));
    await vi.waitFor(() => expect(runtime.listTools().map((item) => item.name)).toContain('from-store'));
    runtime.stop();
    document.body.innerHTML = '<button data-webmcp-tool="after-stop">After stop</button>';
    window.dispatchEvent(new Event('app:state-ready'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.listTools().map((item) => item.name)).not.toContain('after-stop');
  });

  it('reconciles tools when an ignore boundary is toggled dynamically', async () => {
    document.body.innerHTML = '<section id="scope"><button data-webmcp-tool="scoped-action">Action</button></section>';
    const runtime = createWebMCPRuntime({ observerOptions: { debounceMs: 0 } });
    runtime.start();
    expect(runtime.listTools().map((item) => item.name)).toContain('scoped-action');

    document.querySelector('#scope')?.setAttribute('data-webmcp-ignore', '');
    await vi.waitFor(() => expect(runtime.listTools().map((item) => item.name)).not.toContain('scoped-action'));

    document.querySelector('#scope')?.removeAttribute('data-webmcp-ignore');
    await vi.waitFor(() => expect(runtime.listTools().map((item) => item.name)).toContain('scoped-action'));
    runtime.stop();
  });

  it('waits for post-action UI stabilization before returning', async () => {
    document.body.innerHTML = '';
    const handler = vi.fn(() => {
      setTimeout(() => {
        document.body.innerHTML = '<button data-webmcp-tool="async-result">Ready</button>';
      }, 10);
      return { status: 'ok' };
    });
    const runtime = createWebMCPRuntime({
      initialTools: [tool('load.results', 'explicit', 'action', handler)],
      observerOptions: { debounceMs: 0 },
      synchronization: { settleMs: 30, timeoutMs: 200 },
    });
    runtime.start();
    await expect(runtime.invokeTool('load.results', {})).resolves.toEqual({ status: 'ok' });
    expect(runtime.listTools().map((item) => item.name)).toContain('async-result');
    await expect(runtime.waitForIdle({ settleMs: 0, timeoutMs: 20 })).resolves.toMatchObject({
      status: 'idle',
    });
    runtime.stop();
  });

  it('reports a wait timeout while the application declares itself busy', async () => {
    document.body.innerHTML = '<main aria-busy="true"></main>';
    const runtime = createWebMCPRuntime({ synchronization: { settleMs: 0, timeoutMs: 15 } });
    runtime.start();
    await expect(runtime.waitForIdle()).resolves.toMatchObject({ status: 'timeout' });
    document.querySelector('main')?.setAttribute('aria-busy', 'false');
    await expect(runtime.waitForIdle({ timeoutMs: 50 })).resolves.toMatchObject({ status: 'idle' });
    runtime.stop();
  });

  it('does not sync after stop', async () => {
    document.body.innerHTML = '';
    const runtime = createWebMCPRuntime({ observerOptions: { debounceMs: 0 } });
    runtime.start();
    runtime.stop();
    document.body.innerHTML = '<button data-webmcp-tool="late">Late</button>';
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.listTools().map((item) => item.name)).not.toContain('late');
  });

  it('invalidates discovered tools on stop but retains explicit tools on restart', async () => {
    document.body.innerHTML = '<button data-webmcp-tool="temporary">Temporary</button>';
    const runtime = createWebMCPRuntime({ autoDiscover: true, observe: false });
    runtime.start();
    expect(runtime.listTools().map((item) => item.name)).toContain('temporary');
    document.body.innerHTML = '<button data-webmcp-tool="fresh">Fresh</button>';
    runtime.stop();
    runtime.start();
    await vi.waitFor(() => expect(runtime.listTools().map((item) => item.name)).toContain('fresh'));
    expect(runtime.listTools().map((item) => item.name)).not.toContain('temporary');
  });

  it('makes destroy terminal for every runtime mutation', () => {
    const runtime = createWebMCPRuntime({ initialTools: [tool('terminal.tool')] });
    runtime.destroy();
    expect(() => runtime.registerTool(tool('late.tool'))).toThrow(RuntimeDestroyedError);
    expect(() => runtime.unregisterTool('terminal.tool')).toThrow(RuntimeDestroyedError);
    expect(() => runtime.discover()).not.toThrow();
    expect(runtime.listTools()).toHaveLength(0);
  });
});
