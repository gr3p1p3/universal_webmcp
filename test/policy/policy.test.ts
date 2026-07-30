import { describe, expect, it } from 'vitest';
import type { RuntimeTool } from '../../src/core/model.js';
import { evaluateToolPolicy } from '../../src/policy/index.js';

function tool(source: RuntimeTool['provenance']['source'], overrides: Partial<RuntimeTool> = {}): RuntimeTool {
  return {
    name: 'example', description: 'example', kind: 'query', inputSchema: { type: 'object' },
    risk: { level: 'low' }, provenance: { source, confidence: 0.9 },
    handler: () => null, ...overrides,
  };
}

describe('risk policy', () => {
  it.each([
    ['explicit', 'explicit', 'allow'], ['adapter', 'adapter', 'allow'],
  ] as const)('allows the matching source in %s mode', (mode, source, decision) => {
    expect(evaluateToolPolicy(tool(source), mode).decision).toBe(decision);
  });

  it('restricts explicit and adapter modes to their source', () => {
    expect(evaluateToolPolicy(tool('discovery'), 'explicit').decision).toBe('deny');
    expect(evaluateToolPolicy(tool('metadata'), 'adapter').decision).toBe('deny');
  });

  it('treats manual mappings as explicit declarations, never auto discovery', () => {
    expect(evaluateToolPolicy(tool('manual'), 'explicit').decision).toBe('allow');
    expect(evaluateToolPolicy(tool('manual'), 'hybrid').decision).toBe('allow');
    expect(evaluateToolPolicy(tool('manual'), 'auto').decision).toBe('deny');
  });

  it('uses confidence for auto discovery and allows read-only low risk above threshold', () => {
    expect(evaluateToolPolicy(tool('discovery'), 'auto').decision).toBe('allow');
    expect(evaluateToolPolicy(tool('discovery', { provenance: { source: 'discovery', confidence: 0.2 } }), 'auto').decision).toBe('deny');
  });

  it('confirms inferred mutating actions, including heuristic actions', () => {
    const action = tool('discovery', { kind: 'action' });
    expect(evaluateToolPolicy(action, 'auto').decision).toBe('confirm');
    expect(evaluateToolPolicy({ ...action, provenance: { source: 'heuristic', confidence: 0.9 } }, 'auto').decision).toBe('confirm');
  });

  it('keeps hybrid source precedence and does not accept heuristic fallback', () => {
    expect(evaluateToolPolicy(tool('explicit'), 'hybrid').decision).toBe('allow');
    expect(evaluateToolPolicy(tool('adapter'), 'hybrid').decision).toBe('allow');
    expect(evaluateToolPolicy(tool('metadata'), 'hybrid').decision).toBe('allow');
    expect(evaluateToolPolicy(tool('heuristic'), 'hybrid').decision).toBe('deny');
  });

  it('never does not bypass critical or weak-source denial', () => {
    expect(evaluateToolPolicy(tool('explicit', { risk: { level: 'critical' } }), 'explicit', { confirmationPolicy: 'never' }).decision).toBe('deny');
    expect(evaluateToolPolicy(tool('discovery', { provenance: { source: 'discovery', confidence: 0.1 } }), 'auto', { confirmationPolicy: 'never' }).decision).toBe('deny');
    expect(evaluateToolPolicy(tool('discovery', { kind: 'action' }), 'auto', { confirmationPolicy: 'never' }).decision).toBe('deny');
  });

  it('is auditable', () => {
    const result = evaluateToolPolicy(tool('discovery', { kind: 'action' }), 'auto');
    expect(result.reasons.map((item) => item.code)).toContain('mutating-inferred-tool');
  });
});
