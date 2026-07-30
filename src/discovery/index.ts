import type { CapabilityKind, JsonObject, RuntimeTool, RiskLevel, TargetUI } from '../core/model.js';
import { executeDomAction, type DomAction } from '../dom/actions.js';
import { isEffectivelyDisabled, isEffectivelyHidden } from '../dom/state.js';
import {
  createRepeatedItemActionTools,
  createRepeatedListTool,
  type RepeatedListOptions,
} from './repeated-lists.js';

export interface DiscoveryOptions {
  readonly includeOpenShadowRoots?: boolean;
  readonly includeSameOriginFrames?: boolean;
  readonly repeatedLists?: RepeatedListOptions;
}

type RootContext = { readonly root: ParentNode; readonly selector: string; readonly element: Element };

function slug(value: string, fallback: string): string {
  const result = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return result || fallback;
}

function escapeCss(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function attributeSelector(name: string, value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\a ');
  return `[${name}="${escaped}"]`;
}

function elements(root: ParentNode): Element[] {
  const own = root.nodeType === 1 ? [root as Element] : [];
  try { return [...own, ...Array.from(root.querySelectorAll('*'))]; } catch { return own; }
}

function selectorFor(root: ParentNode, element: Element): string {
  if (element === root) return ':scope';
  if (element.id) {
    const selector = `#${escapeCss(element.id)}`;
    try { if (root.querySelectorAll(selector).length === 1) return selector; } catch { /* fall through */ }
  }
  for (const attribute of ['data-webmcp-tool', 'data-webmcp-action', 'name']) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const selector = attributeSelector(attribute, value);
    try { if (root.querySelectorAll(selector).length === 1) return selector; } catch { /* fall through */ }
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    let part = current.tagName.toLowerCase();
    const parent: Node | null = current.parentNode;
    const siblings = parent && 'children' in parent
      ? Array.from((parent as ParentNode & { children: HTMLCollection }).children).filter((item) => item.tagName === current!.tagName)
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    current = parent?.nodeType === 1 ? parent as Element : null;
  }
  return parts.join(' > ');
}

function labelOf(element: Element): string {
  const aria = element.getAttribute('aria-label') || element.getAttribute('title');
  if (aria) return aria;
  if (['input', 'textarea', 'select'].includes(element.tagName.toLowerCase())) {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (control.labels?.[0]?.textContent) return control.labels[0].textContent.trim();
    if (element.getAttribute('placeholder')) return element.getAttribute('placeholder')!;
    if ('name' in control && control.name) return control.name;
  }
  return (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

function explicit(element: Element): boolean {
  return element.hasAttribute('data-webmcp-tool') || element.hasAttribute('data-webmcp-action');
}

function isJavaScriptAnchor(element: Element): boolean {
  return element.tagName.toLowerCase() === 'a'
    && (element.getAttribute('href')?.trim().toLowerCase().startsWith('javascript:') ?? false);
}

function isSensitiveControl(element: Element): boolean {
  if (element.tagName.toLowerCase() !== 'input') return false;
  return ['hidden', 'password', 'file'].includes(
    (element.getAttribute('type') || 'text').toLowerCase(),
  );
}

function isAutomaticallyExcluded(element: Element): boolean {
  return isEffectivelyDisabled(element) || isSensitiveControl(element);
}

function isSearch(form: HTMLFormElement): boolean {
  return form.getAttribute('role') === 'search' || form.getAttribute('aria-label')?.toLowerCase().includes('search') === true || !!form.querySelector('input[type="search"]');
}

function actionFor(element: Element): DomAction | undefined {
  const declared = element.getAttribute('data-webmcp-action');
  if (declared === 'fill' || declared === 'submit' || declared === 'click' || declared === 'select') return declared;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'click';
    if (type === 'checkbox' || type === 'radio') return 'toggle';
    return 'fill';
  }
  if (tag === 'textarea') return 'fill';
  if (tag === 'select') return 'select';
  if (tag === 'form') return 'submit';
  const role = element.getAttribute('role') || '';
  if (['checkbox', 'radio', 'switch'].includes(role)) return 'toggle';
  if (tag === 'button' || tag === 'a' || ['button', 'tab', 'menuitem'].includes(role)) return 'click';
  return undefined;
}

function kindFor(action: DomAction, element: Element): CapabilityKind {
  if (action === 'submit' || element.tagName.toLowerCase() === 'form') return 'form';
  if (element.tagName.toLowerCase() === 'a' && element.hasAttribute('href')) return 'navigation';
  return 'action';
}

const cartPattern = /(?:add|move)\s+(?:to\s+)?(?:cart|basket|bag)|(?:in den|zum)\s+(?:warenkorb|einkaufswagen)|buy now|checkout|place order/i;

function riskFor(action: DomAction, element: Element, label: string): { level: RiskLevel; requiresConfirmation?: boolean } {
  if (cartPattern.test(label)) return { level: 'medium', requiresConfirmation: true };
  if (action === 'click' && element.tagName.toLowerCase() === 'a' && element.hasAttribute('href')) {
    const href = element.getAttribute('href')?.trim() || '';
    if (href.startsWith('#')) return { level: 'low' };
    return { level: 'medium', requiresConfirmation: true };
  }
  return { level: action === 'submit' ? 'medium' : 'low' };
}

function inputSchemaFor(action: DomAction, element: Element): JsonObject {
  if ((action === 'fill' || action === 'submit') && element.tagName.toLowerCase() === 'form') return { type: 'object', properties: { fields: { type: 'object' } } };
  if (action === 'select') return { type: 'object', required: ['value'], properties: { value: { type: 'string' } } };
  if (action === 'toggle') return { type: 'object', required: ['checked'], properties: { checked: { type: 'boolean' } } };
  if (action === 'fill') return { type: 'object', required: ['value'], properties: { value: { type: 'string' } } };
  return { type: 'object' };
}

function semanticPatternFor(element: Element, action: DomAction, label: string): string {
  const role = element.getAttribute('role') || '';
  const rel = element.getAttribute('rel') || '';
  if (cartPattern.test(label)) return 'cart';
  if (role === 'tab') return 'tab';
  if (role === 'menuitem' || element.closest('[role="menu"], menu')) return 'menu';
  if (element.closest('[role="dialog"], dialog')) return 'dialog';
  if (/(?:^|\s)(?:next|prev|previous)(?:\s|$)/i.test(rel)
    || /^(?:next|previous|prev|weiter|zurück)$/i.test(label.trim())) return 'pagination';
  if (element.tagName.toLowerCase() === 'form' && isSearch(element as HTMLFormElement)) return 'search';
  if (action === 'select' || /\b(?:filter|sort|category|facet)\b/i.test(label)) return 'filter';
  if (action === 'toggle') return 'choice';
  return 'control';
}

function contexts(root: ParentNode, options: DiscoveryOptions): RootContext[] {
  const result: RootContext[] = [];
  const seen = new Set<ParentNode>();
  const visit = (current: ParentNode): void => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const element of elements(current)) {
      const selector = selectorFor(current, element);
      result.push({ root: current, selector, element });
      if (options.includeOpenShadowRoots !== false && element.shadowRoot) visit(element.shadowRoot);
      if (options.includeSameOriginFrames !== false && element.tagName.toLowerCase() === 'iframe') {
        try { const frame = element as HTMLIFrameElement; if (frame.contentDocument) visit(frame.contentDocument); } catch { /* cross-origin: ignore */ }
      }
    }
  };
  visit(root);
  return result;
}

export function discoverUI(root: ParentNode, options: DiscoveryOptions = {}): readonly RuntimeTool[] {
  const names = new Set<string>();
  const tools: RuntimeTool[] = [];
  const coveredAccessibleOfferRegions: Element[] = [];
  const coveredRepeatedActionControls = new Set<Element>();
  for (const context of contexts(root, options)) {
    try {
      const { element } = context;
      if (isJavaScriptAnchor(element)) continue;
      if (isEffectivelyHidden(element)) continue;
      const isExplicit = explicit(element);
      if (!isExplicit && isAutomaticallyExcluded(element)) continue;
      const repeatedLabel = labelOf(element);
      {
        const base = `query.${slug(repeatedLabel, 'list')}`;
        let name = base;
        let suffix = 2;
        while (names.has(name)) name = `${base}-${suffix++}`;
        const repeated = createRepeatedListTool({
          root: context.root,
          selector: context.selector,
          element,
          name,
          label: repeatedLabel || undefined,
          options: options.repeatedLists,
        });
        if (repeated) {
          const accessibleOffers = repeated.metadata?.recordScope === 'accessible-offers';
          const covered = accessibleOffers
            && coveredAccessibleOfferRegions.some((region) => region.contains(element));
          if (!covered) {
            names.add(name);
            tools.push(repeated);
            if (accessibleOffers) coveredAccessibleOfferRegions.push(element);
            const repeatedActions = createRepeatedItemActionTools({
              root: context.root,
              selector: context.selector,
              element,
              name,
              label: repeatedLabel || undefined,
              options: options.repeatedLists,
            });
            for (const control of repeatedActions.controls) coveredRepeatedActionControls.add(control);
            for (const groupedTool of repeatedActions.tools) {
              const groupedBase = `${groupedTool.name}.${slug(repeatedLabel, 'list')}`;
              let groupedName = groupedBase;
              let groupedSuffix = 2;
              while (names.has(groupedName)) groupedName = `${groupedBase}-${groupedSuffix++}`;
              names.add(groupedName);
              tools.push({ ...groupedTool, name: groupedName });
            }
          }
        }
      }
      if (!isExplicit && coveredRepeatedActionControls.has(element)) continue;
      const action = actionFor(element);
      if (!action) continue;
      if (!isExplicit && element.tagName.toLowerCase() === 'button' && element.getAttribute('type') === 'button' && !labelOf(element)) continue;
      const label = labelOf(element);
      const declared = element.getAttribute('data-webmcp-tool');
      const base = declared ? slug(declared, 'tool') : `${action}.${slug(label, element.tagName.toLowerCase() === 'form' && isSearch(element as HTMLFormElement) ? 'search' : element.tagName.toLowerCase())}`;
      let name = base;
      let suffix = 2;
      while (names.has(name)) name = `${base}-${suffix++}`;
      names.add(name);
      const targetUI: TargetUI = { selector: context.selector, label: label || undefined, role: element.getAttribute('role') || undefined };
      const provenance = isExplicit ? { source: 'metadata' as const, confidence: 1, sourceId: declared || element.getAttribute('data-webmcp-action') || undefined } : { source: 'discovery' as const, confidence: element.tagName.toLowerCase() === 'form' && isSearch(element as HTMLFormElement) ? 0.95 : 0.9 };
      const semanticPattern = semanticPatternFor(element, action, label);
      tools.push({
        name,
        description: element.getAttribute('data-webmcp-description') || `${action} ${label || element.tagName.toLowerCase()}`,
        kind: kindFor(action, element),
        inputSchema: inputSchemaFor(action, element),
        outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
        risk: riskFor(action, element, label),
        provenance,
        targetUI,
        metadata: { discovery: 'semantic-control', pattern: semanticPattern },
        lifecycle: 'active',
        status: 'available',
        handler: (input) => executeDomAction(context.root, context.selector, action, input),
      });
    } catch {
      // Unsupported or malformed nodes are diagnostic-free and do not stop discovery.
    }
  }
  return Object.freeze(tools);
}

export { executeDomAction, resolveDomTarget } from '../dom/actions.js';
export type { DomAction, DomActionResult } from '../dom/actions.js';
export type { RepeatedListOptions } from './repeated-lists.js';
