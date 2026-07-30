import { describe, expect, it, vi } from 'vitest';
import { executeDomAction } from '../../src/dom/actions.js';

describe('DOM actions', () => {
  it('fills controls and emits input/change', () => {
    document.body.innerHTML = '<input id="q">';
    const input = document.querySelector('input')!;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    expect(executeDomAction(document, '#q', 'fill', { value: 'shoes' })).toMatchObject({ status: 'ok' });
    expect(input.value).toBe('shoes');
    expect(events).toEqual(['input', 'change']);
  });

  it('fills only safe form controls by default and counts skipped controls without values', () => {
    document.body.innerHTML = `<form id="f">
      <input name="query"><input type="hidden" name="csrf"><input type="password" name="password">
      <input type="file" name="file"><input type="checkbox" name="remember"><input type="radio" name="choice">
      <input name="disabled" disabled><textarea name="notes"></textarea>
    </form>`;
    const result = executeDomAction(document, '#f', 'fill', { fields: {
      query: 'shoes', csrf: 'secret-token', password: 'secret-password', file: 'ignored',
      remember: 'yes', choice: 'a', disabled: 'ignored', notes: 'local note',
    } });

    expect(result).toMatchObject({ status: 'ok', result: { fields: 2, skipped: 6 } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect((document.querySelector('[name="query"]') as HTMLInputElement).value).toBe('shoes');
    expect((document.querySelector('[name="password"]') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('[name="csrf"]') as HTMLInputElement).value).toBe('');
  });

  it('allows a password only through an explicit opt-in', () => {
    document.body.innerHTML = '<form id="login"><input name="user"><input type="password" name="password"></form>';
    const blocked = executeDomAction(document, '#login', 'fill', { fields: { password: 'secret' } });
    expect(blocked).toMatchObject({ status: 'ok', result: { fields: 0, skipped: 1 } });
    expect((document.querySelector('[name="password"]') as HTMLInputElement).value).toBe('');

    const allowed = executeDomAction(document, '#login', 'fill', { fields: { password: 'secret' } }, { allowSensitiveFormFields: true });
    expect(allowed).toMatchObject({ status: 'ok', result: { fields: 1, skipped: 0 } });
    expect(JSON.stringify(allowed)).not.toContain('secret');
    expect((document.querySelector('[name="password"]') as HTMLInputElement).value).toBe('secret');
  });

  it('selects and submits through browser events', () => {
    document.body.innerHTML = '<form id="f"><select id="s"><option value="a">A</option><option value="b">B</option></select><button>Go</button></form>';
    const form = document.querySelector('form')!;
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);

    expect(executeDomAction(document, '#s', 'select', { value: 'b' })).toMatchObject({ status: 'ok' });
    expect(executeDomAction(document, '#f', 'submit')).toMatchObject({ status: 'ok' });
    expect(document.querySelector('select')!.value).toBe('b');
    expect(submitted).toHaveBeenCalledOnce();
  });

  it('toggles native and ARIA controls through a boolean contract', () => {
    document.body.innerHTML = `
      <input id="remember" type="checkbox">
      <input id="choice" type="radio">
      <button id="switch" role="switch" aria-checked="false">Notifications</button>`;
    const checkbox = document.querySelector('#remember') as HTMLInputElement;
    const changes: string[] = [];
    checkbox.addEventListener('change', () => changes.push('checkbox'));
    document.querySelector('#switch')?.addEventListener('click', (event) => {
      const target = event.currentTarget as Element;
      target.setAttribute('aria-checked', target.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });

    expect(executeDomAction(document, '#remember', 'toggle', { checked: true }))
      .toMatchObject({ status: 'ok', result: { checked: true } });
    expect(executeDomAction(document, '#choice', 'toggle', { checked: false }))
      .toMatchObject({ status: 'error', error: 'radio-cannot-be-unchecked' });
    expect(executeDomAction(document, '#switch', 'toggle', { checked: true }))
      .toMatchObject({ status: 'ok', result: { checked: true } });
    expect(changes).toEqual(['checkbox']);
  });

  it('returns a serializable error for a stale target', () => {
    document.body.innerHTML = '<button id="go">Go</button>';
    const result = executeDomAction(document, '#go', 'click');
    document.querySelector('button')!.remove();
    const stale = executeDomAction(document, '#go', 'click');
    expect(result.status).toBe('ok');
    expect(stale).toEqual({ status: 'error', action: 'click', selector: '#go', error: 'target-not-found' });
    expect(JSON.parse(JSON.stringify(stale))).toEqual(stale);
  });

  it('does not report success for disabled, hidden, or sensitive controls', () => {
    document.body.innerHTML = '<input id="disabled" disabled><input id="hidden" hidden><input id="password" type="password"><input id="search">';
    expect(executeDomAction(document, '#disabled', 'fill', { value: 'x' })).toMatchObject({ status: 'error', error: 'target-disabled' });
    expect(executeDomAction(document, '#hidden', 'fill', { value: 'x' })).toMatchObject({ status: 'error', error: 'target-disabled' });
    expect(executeDomAction(document, '#password', 'fill', { value: 'x' })).toMatchObject({ status: 'error', error: 'target-disabled' });
    expect(executeDomAction(document, '#search', 'fill', { value: 'x' })).toMatchObject({ status: 'ok' });
  });

  it('rejects aria-disabled, inert, and fieldset-disabled targets through ancestor state', () => {
    document.body.innerHTML = `
      <div aria-disabled="true"><button id="aria-disabled">Aria disabled</button></div>
      <div inert><button id="inert">Inert</button></div>
      <fieldset disabled><input id="fieldset-input"></fieldset>`;
    expect(executeDomAction(document, '#aria-disabled', 'click')).toMatchObject({ status: 'error', error: 'target-disabled' });
    expect(executeDomAction(document, '#inert', 'click')).toMatchObject({ status: 'error', error: 'target-disabled' });
    expect(executeDomAction(document, '#fieldset-input', 'fill', { value: 'blocked' })).toMatchObject({ status: 'error', error: 'target-disabled' });
  });

  it('rejects disabled options and disabled optgroups before changing select value', () => {
    document.body.innerHTML = `<select id="sort">
      <option value="safe">Safe</option>
      <option value="disabled" disabled>Disabled</option>
      <option value="aria-disabled" aria-disabled="true">Aria disabled</option>
      <optgroup label="Unavailable" disabled><option value="grouped">Grouped</option></optgroup>
    </select>`;
    const select = document.querySelector('#sort') as HTMLSelectElement;
    select.value = 'safe';
    const disabled = executeDomAction(document, '#sort', 'select', { value: 'disabled' });
    expect(disabled).toEqual({ status: 'error', action: 'select', selector: '#sort', error: 'option-disabled' });
    expect(select.value).toBe('safe');
    const grouped = executeDomAction(document, '#sort', 'select', { value: 'grouped' });
    expect(grouped).toEqual({ status: 'error', action: 'select', selector: '#sort', error: 'option-disabled' });
    expect(select.value).toBe('safe');
    const ariaDisabled = executeDomAction(document, '#sort', 'select', { value: 'aria-disabled' });
    expect(ariaDisabled).toEqual({ status: 'error', action: 'select', selector: '#sort', error: 'option-disabled' });
    expect(select.value).toBe('safe');
    expect(JSON.parse(JSON.stringify(grouped))).toEqual(grouped);
  });

  it('rejects targets inside a hidden or inert ShadowRoot host', () => {
    const hiddenHost = document.createElement('div');
    hiddenHost.hidden = true;
    const hiddenShadow = hiddenHost.attachShadow({ mode: 'open' });
    hiddenShadow.innerHTML = '<input id="hidden-shadow-input">';
    document.body.append(hiddenHost);
    const inertHost = document.createElement('div');
    inertHost.setAttribute('inert', '');
    const inertShadow = inertHost.attachShadow({ mode: 'open' });
    inertShadow.innerHTML = '<button id="inert-shadow-button">Inert shadow</button>';
    document.body.append(inertHost);

    expect(executeDomAction(hiddenShadow, '#hidden-shadow-input', 'fill', { value: 'blocked' })).toMatchObject({ status: 'error', error: 'target-disabled' });
    expect(executeDomAction(inertShadow, '#inert-shadow-button', 'click')).toMatchObject({ status: 'error', error: 'target-disabled' });
  });
});
