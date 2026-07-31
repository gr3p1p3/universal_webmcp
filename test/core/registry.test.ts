import { describe, expect, it, vi } from 'vitest';
import {
  CapabilityRegistry,
  CapabilityValidationError,
  DuplicateCapabilityError,
  MissingCapabilityError,
  type RuntimeTool,
} from '../../src/index.js';

const tool = (name = 'orders.list'): RuntimeTool => ({
  name,
  description: 'List orders',
  kind: 'query',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'array' },
  risk: { level: 'low' },
  provenance: { source: 'explicit', confidence: 1 },
  handler: async () => [],
});

describe('CapabilityRegistry', () => {
  it('registers, retrieves, lists and unregisters capabilities', () => {
    const registry = new CapabilityRegistry();
    const registered = registry.register(tool());

    expect(registry.get('orders.list')).toBe(registered);
    expect(registry.list()).toHaveLength(1);
    expect(registry.unregister('orders.list')).toBe(true);
    expect(registry.get('orders.list')).toBeUndefined();
  });

  it('handles duplicates deterministically and supports replace/upsert', () => {
    const registry = new CapabilityRegistry();
    registry.register(tool());
    expect(() => registry.register(tool())).toThrow(DuplicateCapabilityError);
    expect(() => registry.replace(tool('missing'))).toThrow(MissingCapabilityError);
    expect(registry.upsert({ ...tool(), description: 'Updated' }).description).toBe('Updated');
  });

  it('emits minimal change diagnostics', () => {
    const registry = new CapabilityRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register(tool());
    registry.replace({ ...tool(), description: 'Updated' });
    registry.unregister('orders.list');
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['register', 'replace', 'unregister']);
  });

  it('returns an immutable snapshot detached from input schemas', () => {
    const registry = new CapabilityRegistry();
    const input = tool();
    registry.register(input);
    Object.assign(input.inputSchema, { type: 'changed' });
    const snapshot = registry.snapshot();
    expect(snapshot[0]?.inputSchema.type).toBe('object');
    expect(() => Object.assign(snapshot, { 1: tool('other') })).toThrow();
    expect(() => { if (snapshot[0]) Object.assign(snapshot[0], { name: 'changed' }); }).toThrow();
  });

  it('copies and freezes public metadata', () => {
    const registry = new CapabilityRegistry();
    const metadata = { source: 'fixture', nested: { safe: true } };
    const registered = registry.register({ ...tool(), metadata });
    metadata.nested.safe = false;
    expect(registered.metadata).toEqual({ source: 'fixture', nested: { safe: true } });
    expect(Object.isFrozen(registered.metadata)).toBe(true);
    expect(() => { if (registered.metadata) Object.assign(registered.metadata, { injected: true }); }).toThrow();
  });

  it('validates stable names, descriptions, schemas and confidence', () => {
    const registry = new CapabilityRegistry();
    expect(() => registry.register(tool(''))).toThrow(CapabilityValidationError);
    expect(() => registry.register(tool('not stable name'))).toThrow(CapabilityValidationError);
    expect(() => registry.register(tool('x'.repeat(129)))).toThrow(CapabilityValidationError);
    expect(registry.register(tool('1.valid-name')).name).toBe('1.valid-name');
    expect(() => registry.register({ ...tool(), description: ' ' })).toThrow(CapabilityValidationError);
    expect(() => registry.register({ ...tool(), inputSchema: [] as unknown as RuntimeTool['inputSchema'] })).toThrow(CapabilityValidationError);
    expect(() => registry.register({ ...tool(), provenance: { source: 'explicit', confidence: 2 } })).toThrow(CapabilityValidationError);
    expect(() => registry.register({
      ...tool(),
      annotations: { readOnlyHint: 'false' } as unknown as RuntimeTool['annotations'],
    })).toThrow(CapabilityValidationError);
  });
});
