import { describe, expect, it, vi } from 'vitest';
import { createManualMappingTool } from '../../src/mapping/index.js';

describe('manual mappings', () => {
  it('creates click and fill tools with explicit manual provenance', async () => {
    document.body.innerHTML = '<button id="go">Go</button><input id="q">';
    const clicked = vi.fn();
    document.querySelector('#go')?.addEventListener('click', clicked);
    const click = createManualMappingTool({ name: 'go', selector: '#go', action: 'click' });
    const fill = createManualMappingTool({ name: 'search', selector: '#q', action: 'fill' });

    expect(click.provenance).toMatchObject({ source: 'manual', confidence: 1 });
    await click.handler({});
    await fill.handler({ value: 'shoes' });
    expect(clicked).toHaveBeenCalledOnce();
    expect((document.querySelector('#q') as HTMLInputElement).value).toBe('shoes');
  });

  it('supports select and resolves a replacement element at call time', async () => {
    document.body.innerHTML = '<select id="sort"><option value="old">Old</option></select>';
    const mapping = createManualMappingTool({ name: 'sort', selector: '#sort', action: 'select' });
    document.body.innerHTML = '<select id="sort"><option value="new">New</option></select>';

    expect(mapping.handler({ value: 'new' })).toMatchObject({ status: 'ok', action: 'select' });
    expect((document.querySelector('#sort') as HTMLSelectElement).value).toBe('new');
  });

  it('requires an explicit mapping opt-in for password form fields', async () => {
    document.body.innerHTML = '<form id="login"><input name="user"><input type="password" name="password"></form>';
    const safe = createManualMappingTool({ name: 'login-safe', selector: '#login', action: 'fill' });
    const explicit = createManualMappingTool({ name: 'login-explicit', selector: '#login', action: 'fill', allowSensitiveFormFields: true });

    await safe.handler({ fields: { password: 'secret' } });
    expect((document.querySelector('[name="password"]') as HTMLInputElement).value).toBe('');
    const result = await explicit.handler({ fields: { password: 'secret' } });
    expect(result).toMatchObject({ status: 'ok', result: { fields: 1, skipped: 0 } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('returns serializable errors and validates declarations', async () => {
    expect(() => createManualMappingTool({ name: '', selector: '#x', action: 'click' })).toThrow(/name/);
    expect(() => createManualMappingTool({ name: 'x', selector: '', action: 'click' })).toThrow(/selector/);
    expect(() => createManualMappingTool({ name: 'x', selector: '#x', action: 'bad' as 'click' })).toThrow(/action/);
    document.body.innerHTML = '';
    const tool = createManualMappingTool({ name: 'missing', selector: '#missing', action: 'click' });
    const result = await tool.handler({});
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result).toMatchObject({ status: 'error', error: 'target-not-found' });
  });
});
