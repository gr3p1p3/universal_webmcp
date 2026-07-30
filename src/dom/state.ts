export interface EffectiveDomState {
  readonly hidden: boolean;
  readonly ariaHidden: boolean;
  readonly cssHidden: boolean;
  readonly inert: boolean;
  readonly ariaDisabled: boolean;
  readonly disabled: boolean;
}

function isTrueAttribute(element: Element, name: string): boolean {
  return element.getAttribute(name)?.trim().toLowerCase() === 'true';
}

function isDisabledProperty(element: Element): boolean {
  return 'disabled' in element && (element as Element & { readonly disabled?: boolean }).disabled === true;
}

function isInertProperty(element: Element): boolean {
  return 'inert' in element && (element as Element & { readonly inert?: boolean }).inert === true;
}

function isCssHidden(element: Element): boolean {
  const view = element.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return false;
  try {
    const style = view.getComputedStyle(element);
    return style.display === 'none'
      || style.visibility === 'hidden'
      || style.visibility === 'collapse'
      || style.contentVisibility === 'hidden';
  } catch {
    return false;
  }
}

function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  if (root && typeof root === 'object' && 'host' in root) {
    const host = (root as { host?: unknown }).host;
    return host && typeof host === 'object' && (host as { nodeType?: unknown }).nodeType === 1 ? host as Element : null;
  }
  return null;
}

/**
 * Reads interaction state from the target and its composed-tree ancestors.
 * In particular, a ShadowRoot's host is treated as the next ancestor.
 */
export function getEffectiveDomState(element: Element): EffectiveDomState {
  let current: Element | null = element;
  let hidden = false;
  let ariaHidden = false;
  let cssHidden = false;
  let inert = false;
  let ariaDisabled = false;
  let disabled = false;
  while (current) {
    hidden ||= current.hasAttribute('hidden');
    ariaHidden ||= isTrueAttribute(current, 'aria-hidden');
    cssHidden ||= isCssHidden(current);
    inert ||= current.hasAttribute('inert') || isInertProperty(current);
    ariaDisabled ||= isTrueAttribute(current, 'aria-disabled');
    disabled ||= isDisabledProperty(current) || (current.tagName.toLowerCase() === 'fieldset' && isDisabledProperty(current));
    current = composedParent(current);
  }
  return { hidden, ariaHidden, cssHidden, inert, ariaDisabled, disabled };
}

export function isEffectivelyHidden(element: Element): boolean {
  const state = getEffectiveDomState(element);
  return state.hidden || state.ariaHidden || state.cssHidden || state.inert;
}

export function isEffectivelyDisabled(element: Element): boolean {
  const state = getEffectiveDomState(element);
  return state.disabled || state.ariaDisabled || state.inert;
}
