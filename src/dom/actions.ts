import type { JsonObject, JsonValue } from '../core/model.js';
import { getEffectiveDomState } from './state.js';

export type DomAction = 'fill' | 'submit' | 'click' | 'select' | 'toggle';
export interface DomActionOptions {
  /** Explicit application-owned opt-in for password fields in a mapped form. */
  readonly allowSensitiveFormFields?: boolean;
}
export type DomActionResult = {
  readonly status: 'ok' | 'error';
  readonly action: DomAction;
  readonly selector: string;
  readonly result?: JsonValue;
  readonly error?: string;
};

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function describe(element: Element): JsonObject {
  return { tagName: element.tagName.toLowerCase(), id: element.id || null };
}

function isTag(element: Element, tag: string): boolean { return element.tagName.toLowerCase() === tag; }

function isTextControl(element: Element): boolean {
  if (isTag(element, 'textarea')) return true;
  if (!isTag(element, 'input')) return false;
  return !['button', 'submit', 'reset', 'image', 'hidden', 'password', 'file', 'checkbox', 'radio'].includes(
    ((element as HTMLInputElement).type || 'text').toLowerCase(),
  );
}

export function resolveDomTarget(root: ParentNode, selector: string): Element | null {
  if (selector === ':scope' && root.nodeType === 1) return root as Element;
  try {
    const node = root.querySelector(selector);
    return node && node.nodeType === 1 ? node : null;
  } catch {
    return null;
  }
}

function isDisabledTarget(element: Element, options: DomActionOptions = {}): boolean {
  const state = getEffectiveDomState(element);
  if (state.hidden || state.ariaHidden || state.cssHidden || state.inert || state.ariaDisabled || state.disabled) return true;
  if (isTag(element, 'input') && ['hidden', 'password', 'file'].includes(
    ((element as HTMLInputElement).type || 'text').toLowerCase(),
  )) return !(options.allowSensitiveFormFields === true && (element as HTMLInputElement).type.toLowerCase() === 'password');
  return false;
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = isTag(element, 'textarea') ? Object.getPrototypeOf(element) : Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function fillForm(form: HTMLFormElement, input: JsonObject, options: DomActionOptions = {}): JsonObject {
  const fields = input.fields;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return { fields: 0, skipped: 0 };
  }
  let count = 0;
  let skipped = 0;
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== 'string') { skipped += 1; continue; }
    const control = form.elements.namedItem(name);
    const candidate = control as Element | null;
    const sensitivePassword = candidate !== null
      && isTag(candidate, 'input')
      && (candidate as HTMLInputElement).type.toLowerCase() === 'password'
      && options.allowSensitiveFormFields === true;
    if (candidate && candidate.nodeType === 1 && (isTextControl(candidate) || sensitivePassword) && !isDisabledTarget(candidate, options)) {
      setInputValue(candidate as HTMLInputElement | HTMLTextAreaElement, value);
      count += 1;
    } else {
      skipped += 1;
    }
  }
  return { fields: count, skipped };
}

/** Execute an action against an already-resolved element. */
export function executeElementAction(
  target: Element,
  selector: string,
  action: DomAction,
  input: JsonObject = {},
  options: DomActionOptions = {},
): DomActionResult {
  if (isDisabledTarget(target, options)) return { status: 'error', action, selector, error: 'target-disabled' };

  try {
    switch (action) {
      case 'fill': {
        if (isTag(target, 'form')) {
          return { status: 'ok', action, selector, result: fillForm(target as HTMLFormElement, input, options) };
        }
        const sensitivePassword = isTag(target, 'input')
          && (target as HTMLInputElement).type.toLowerCase() === 'password'
          && options.allowSensitiveFormFields === true;
        if (!isTextControl(target) && !sensitivePassword) {
          return { status: 'error', action, selector, error: 'target-not-fillable' };
        }
        const value = asString(input.value);
        if (value === undefined) return { status: 'error', action, selector, error: 'value-must-be-string' };
        setInputValue(target as HTMLInputElement | HTMLTextAreaElement, value);
        return { status: 'ok', action, selector, result: { updated: true } };
      }
      case 'select': {
        if (!isTag(target, 'select')) {
          return { status: 'error', action, selector, error: 'target-not-select' };
        }
        const value = asString(input.value);
        if (value === undefined) return { status: 'error', action, selector, error: 'value-must-be-string' };
        const select = target as HTMLSelectElement;
        const option = Array.from(select.options).find((candidate) => candidate.value === value);
        if (!option) {
          return { status: 'error', action, selector, error: 'option-not-found' };
        }
        const optgroup = option.parentElement?.tagName.toLowerCase() === 'optgroup'
          ? option.parentElement as HTMLOptGroupElement
          : null;
        if (option.disabled || option.getAttribute('aria-disabled') === 'true' || optgroup?.disabled) {
          return { status: 'error', action, selector, error: 'option-disabled' };
        }
        select.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { status: 'ok', action, selector, result: { updated: true } };
      }
      case 'toggle': {
        const checked = input.checked;
        if (typeof checked !== 'boolean') {
          return { status: 'error', action, selector, error: 'checked-must-be-boolean' };
        }
        if (isTag(target, 'input')) {
          const control = target as HTMLInputElement;
          const type = control.type.toLowerCase();
          if (type !== 'checkbox' && type !== 'radio') {
            return { status: 'error', action, selector, error: 'target-not-toggle' };
          }
          if (type === 'radio' && checked === false) {
            return { status: 'error', action, selector, error: 'radio-cannot-be-unchecked' };
          }
          if (control.checked !== checked) {
            control.checked = checked;
            control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            control.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          }
          return { status: 'ok', action, selector, result: { checked: control.checked } };
        }
        const role = target.getAttribute('role');
        if (!['checkbox', 'radio', 'switch'].includes(role || '') || !target.hasAttribute('aria-checked')) {
          return { status: 'error', action, selector, error: 'target-not-toggle' };
        }
        const current = target.getAttribute('aria-checked') === 'true';
        if (role === 'radio' && checked === false) {
          return { status: 'error', action, selector, error: 'radio-cannot-be-unchecked' };
        }
        if (current !== checked) {
          if (typeof (target as Element & { click?: () => void }).click !== 'function') {
            return { status: 'error', action, selector, error: 'target-not-clickable' };
          }
          (target as Element & { click: () => void }).click();
        }
        return {
          status: 'ok',
          action,
          selector,
          result: { checked: target.getAttribute('aria-checked') === 'true' },
        };
      }
      case 'click':
        if (typeof (target as Element & { click?: () => void }).click !== 'function') return { status: 'error', action, selector, error: 'target-not-clickable' };
        (target as Element & { click: () => void }).click();
        return { status: 'ok', action, selector, result: describe(target) };
      case 'submit': {
        const form = (isTag(target, 'form') ? target : target.closest('form')) as HTMLFormElement | null;
        if (!form) return { status: 'error', action, selector, error: 'form-not-found' };
        const filled = fillForm(form, input, options);
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
        return { status: 'ok', action, selector, result: { ...filled, submitted: true } };
      }
    }
  } catch {
    return { status: 'error', action, selector, error: 'action-failed' };
  }
}

export function executeDomAction(
  root: ParentNode,
  selector: string,
  action: DomAction,
  input: JsonObject = {},
  options: DomActionOptions = {},
): DomActionResult {
  const target = resolveDomTarget(root, selector);
  if (!target) return { status: 'error', action, selector, error: 'target-not-found' };
  return executeElementAction(target, selector, action, input, options);
}
