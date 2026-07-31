import type { CapabilityKind, JsonObject, RuntimeTool, RiskLevel, TargetUI } from '../core/model.js';
import { executeDomAction, type DomAction } from '../dom/actions.js';
import { isEffectivelyDisabled, isEffectivelyHidden } from '../dom/state.js';
import {
  createRepeatedItemActionTools,
  createRepeatedListTool,
  type RepeatedListOptions,
} from './repeated-lists.js';
import {
  compileSemanticCandidates,
  type SemanticCandidate,
  type SemanticCatalogOptions,
  type SemanticCompilation,
  type SemanticRule,
  type SemanticUIGraph,
} from './semantic-graph.js';

export interface DiscoveryOptions {
  readonly includeOpenShadowRoots?: boolean;
  readonly includeSameOriginFrames?: boolean;
  readonly repeatedLists?: RepeatedListOptions;
  readonly catalog?: SemanticCatalogOptions;
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
  const labelledBy = element.getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => elementByIdInTree(element, id)?.textContent?.trim())
    .filter((value): value is string => !!value)
    .join(' ');
  const aria = labelledBy || element.getAttribute('aria-label') || element.getAttribute('title');
  if (aria) return aria;
  if (['input', 'textarea', 'select'].includes(element.tagName.toLowerCase())) {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (control.labels?.[0]?.textContent) return control.labels[0].textContent.trim();
    if (element.getAttribute('placeholder')) return element.getAttribute('placeholder')!;
    if ('name' in control && control.name) return control.name;
  }
  return (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

function repeatedListNameSeed(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => elementByIdInTree(element, id)?.textContent?.trim())
    .filter((value): value is string => !!value)
    .join(' ');
  const accessibleName = labelledBy
    || element.getAttribute('aria-label')
    || element.getAttribute('title');
  if (accessibleName) return accessibleName;
  if (element.id) return element.id;
  const testId = element.getAttribute('data-testid');
  if (testId) return testId;
  const role = element.getAttribute('role');
  if (role && role !== 'list') return role;
  return 'list';
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
const destructivePattern = /\b(?:delete|remove|destroy|erase|deactivate|close account|cancel subscription|löschen|entfernen)\b/i;

function stricterRisk(
  left: { level: RiskLevel; requiresConfirmation?: boolean },
  right: { level: RiskLevel; requiresConfirmation?: boolean },
): { level: RiskLevel; requiresConfirmation?: boolean } {
  const order: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  const level = order.indexOf(left.level) >= order.indexOf(right.level) ? left.level : right.level;
  return left.requiresConfirmation || right.requiresConfirmation
    ? { level, requiresConfirmation: true }
    : { level };
}

function riskFor(action: DomAction, element: Element, label: string): { level: RiskLevel; requiresConfirmation?: boolean } {
  let risk: { level: RiskLevel; requiresConfirmation?: boolean };
  if (destructivePattern.test(label)) risk = { level: 'high', requiresConfirmation: true };
  else if (cartPattern.test(label)) risk = { level: 'medium', requiresConfirmation: true };
  else if (action === 'click' && element.tagName.toLowerCase() === 'a' && element.hasAttribute('href')) {
    const href = element.getAttribute('href')?.trim() || '';
    risk = href.startsWith('#') ? { level: 'low' } : { level: 'medium', requiresConfirmation: true };
  } else risk = { level: action === 'submit' ? 'medium' : 'low' };

  if (action === 'submit' && element.tagName.toLowerCase() === 'form') {
    const submitters = enabledFormSubmitters(element as HTMLFormElement);
    if (submitters.length === 1) {
      const submitter = submitters[0]!;
      risk = stricterRisk(risk, riskFor('click', submitter, labelOf(submitter)));
    }
  }
  return risk;
}

function inputSchemaFor(action: DomAction, element: Element): JsonObject {
  if ((action === 'fill' || action === 'submit') && element.tagName.toLowerCase() === 'form') {
    const properties = Object.create(null) as Record<string, JsonObject>;
    const form = element as HTMLFormElement;
    const controls = Array.from(form.elements).filter(isElementNode);
    const nameCounts = new Map<string, number>();
    for (const control of controls) {
      const name = String(control.getAttribute('name') || '');
      if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    for (const control of controls) {
      const name = String(control.getAttribute('name') || '');
      if (!name || nameCounts.get(name) !== 1 || isSensitiveControl(control) || isEffectivelyDisabled(control)) continue;
      const tag = control.tagName.toLowerCase();
      const type = (control.getAttribute('type') || 'text').toLowerCase();
      if (tag !== 'textarea' && tag !== 'input') continue;
      if (['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(type)) continue;
      const description = control.getAttribute('toolparamdescription') || labelOf(control);
      properties[name] = stringSchemaFor(control, description);
    }
    return {
      type: 'object',
      required: ['fields'],
      properties: {
        fields: {
          type: 'object',
          properties,
          additionalProperties: false,
        },
      },
    };
  }
  if (action === 'select') {
    const select = element.tagName.toLowerCase() === 'select'
      ? element as HTMLSelectElement
      : undefined;
    const options = select
      ? [...new Set(Array.from(select.options)
        .filter((option) => (
          !option.disabled
          && !(option.parentElement?.tagName.toLowerCase() === 'optgroup'
            && (option.parentElement as HTMLOptGroupElement).disabled)
          && !(select.required && !select.multiple && option.value === '')
        ))
        .map((option) => option.value))]
      : [];
    return {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'string',
          ...(options.length > 0 ? { enum: options } : {}),
          ...(labelOf(element) ? { description: labelOf(element) } : {}),
        },
      },
    };
  }
  if (action === 'toggle') return { type: 'object', required: ['checked'], properties: { checked: { type: 'boolean' } } };
  if (action === 'fill') {
    const description = element.getAttribute('toolparamdescription') || labelOf(element);
    const property = stringSchemaFor(element, description);
    return { type: 'object', required: ['value'], properties: { value: property } };
  }
  return { type: 'object' };
}

function isValueMissingCapable(element: Element): boolean {
  if (!element.hasAttribute('required') || element.hasAttribute('readonly')) return false;
  if (element.tagName.toLowerCase() === 'textarea') return true;
  if (element.tagName.toLowerCase() !== 'input') return false;
  return [
    'text', 'search', 'url', 'tel', 'email', 'date', 'month', 'week',
    'time', 'datetime-local', 'number',
  ].includes(normalizedInputType(element));
}

function stringSchemaFor(
  element: Element,
  description?: string,
): Record<string, JsonObject[keyof JsonObject]> {
  const schema: Record<string, JsonObject[keyof JsonObject]> = { type: 'string' };
  if (description) schema.description = description;
  const type = normalizedInputType(element);
  const constraints: Record<string, JsonObject[keyof JsonObject]> = {};
  if (type === 'email' && !element.hasAttribute('multiple')) constraints.format = 'email';
  const supportsPattern = element.tagName.toLowerCase() === 'input'
    && ['text', 'search', 'url', 'tel', 'email'].includes(type);
  const required = isValueMissingCapable(element);
  // HTML length constraints count UTF-16 code units, while JSON Schema counts
  // Unicode code points. Omitting them avoids changing the accepted input set.
  if (required) constraints.minLength = 1;
  const pattern = supportsPattern ? jsonSchemaPattern(element.getAttribute('pattern')) : undefined;
  if (pattern) constraints.pattern = pattern;
  if (required) Object.assign(schema, constraints);
  else if (Object.keys(constraints).length > 0) schema.anyOf = [{ const: '' }, constraints];
  return schema;
}

function normalizedInputType(element: Element): string {
  if (element.tagName.toLowerCase() !== 'input') return '';
  const value = (element as Element & { readonly type?: string }).type;
  return (value || 'text').toLowerCase();
}

function isElementNode(value: unknown): value is Element {
  return !!value
    && typeof value === 'object'
    && (value as Node).nodeType === 1
    && typeof (value as Element).getAttribute === 'function';
}

function jsonSchemaPattern(pattern: string | null): string | undefined {
  if (pattern === null || /(?:&&|--|\\q\{)/.test(pattern)) return undefined;
  const anchored = `^(?:${pattern})$`;
  try {
    new RegExp(pattern, 'v');
    new RegExp(anchored, 'u');
    return anchored;
  } catch {
    return undefined;
  }
}

function elementByIdInTree(element: Element, id: string): Element | null {
  const root = element.getRootNode() as ParentNode & {
    readonly nodeType?: number;
    getElementById?: (value: string) => Element | null;
  };
  if (typeof root.getElementById === 'function') return root.getElementById(id);
  if (root.nodeType === 1 && (root as Element).id === id) return root as Element;
  try { return root.querySelector(attributeSelector('id', id)); } catch { return null; }
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function ownerIdentity(element: Element): string {
  const explicitScope = element.closest('[data-webmcp-scope]');
  const associatedForm = 'form' in element
    ? (element as Element & { readonly form?: HTMLFormElement | null }).form
    : null;
  const owner = explicitScope
    || associatedForm
    || element.closest(
      'form, dialog, [role="dialog"], [role="search"], main, nav, aside, section, article',
    );
  if (!owner) return treeIdentity(element.getRootNode());
  return [
    owner.tagName.toLowerCase(),
    owner.getAttribute('data-webmcp-scope') || '',
    owner.id || '',
    owner.getAttribute('role') || '',
    normalized(
      owner.getAttribute('aria-label')
      || owner.getAttribute('title')
      || owner.getAttribute('name')
      || '',
    ),
    structuralPath(owner),
  ].join(':');
}

function structuralPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`#${current.id}`);
      break;
    }
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((item) => item.tagName === current!.tagName)
      : [];
    if (siblings.length > 1) part += `:${siblings.indexOf(current) + 1}`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return `${treeIdentity(element.getRootNode())}/${parts.join('/')}`;
}

function treeIdentity(root: Node): string {
  if ('host' in root && isElementNode((root as ShadowRoot).host)) {
    return `${structuralPath((root as ShadowRoot).host)}::shadow`;
  }
  if (root.nodeType === 9) {
    const frame = (root as Document).defaultView?.frameElement;
    return frame && isElementNode(frame) ? `${structuralPath(frame)}::frame` : 'document';
  }
  if (root.nodeType === 1) {
    const element = root as Element;
    return `detached:${element.tagName.toLowerCase()}:${element.id || ''}`;
  }
  return 'tree';
}

function fieldSignature(element: Element): string {
  if (element.tagName.toLowerCase() !== 'form') return '';
  return Array.from((element as HTMLFormElement).elements)
    .filter(isElementNode)
    .map((control) => `${control.tagName.toLowerCase()}:${control.getAttribute('name') || ''}:${control.getAttribute('type') || ''}`)
    .sort()
    .join(',');
}

function semanticIdentity(
  element: Element,
  action: DomAction | undefined,
  pattern: string,
  label: string,
  selector: string,
): { id: string; key: string } {
  const declared = element.getAttribute('data-webmcp-tool');
  const anchor = declared
    ? `declared:${normalized(declared)}`
    : element.id
      ? `id:${element.id}`
      : element.getAttribute('name')
        ? `name:${element.getAttribute('name')}`
        : `label:${normalized(label)}`;
  const stableName = !!element.getAttribute('name') && selector.startsWith('[name=');
  const stableAnchor = !!(declared || element.id || stableName)
    && !selector.includes(':nth-of-type');
  const signature = [
    treeIdentity(element.getRootNode()),
    action || 'query',
    pattern,
    ...(stableAnchor ? [] : [ownerIdentity(element)]),
    anchor,
    fieldSignature(element),
    ...(stableAnchor ? [] : [selector]),
  ].join('|');
  const equivalence = element.getAttribute('data-webmcp-equivalent')?.trim();
  const key = equivalence
    ? ['equivalent', action || 'query', pattern, ownerIdentity(element), normalized(equivalence)].join('|')
    : `${treeIdentity(element.getRootNode())}|${signature}|target:${selector}`;
  return { id: `ui-${stableHash(signature)}`, key };
}

function stableNameSeed(element: Element, label: string, selector: string): string {
  const declared = element.getAttribute('data-webmcp-tool');
  if (declared) return declared;
  if (element.id) return element.id;
  if (['input', 'textarea', 'select'].includes(element.tagName.toLowerCase())) {
    const name = element.getAttribute('name');
    if (name && selector.startsWith('[name=')) return name;
    if (label && normalized(label) !== normalized(name || '')) return label;
    const owner = 'form' in element
      ? (element as Element & { readonly form?: HTMLFormElement | null }).form
      : null;
    const ownerName = owner?.id || owner?.getAttribute('aria-label');
    if (name && ownerName) return `${ownerName}-${name}`;
  }
  return label;
}

function ruleFor(element: Element, action: DomAction, label: string): { rule: SemanticRule; priority: number } {
  if (explicit(element)) return { rule: 'explicit-metadata', priority: 1_000 };
  if (element.tagName.toLowerCase() === 'form') return { rule: 'semantic-form', priority: 900 };
  if (element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') || element.hasAttribute('role')) {
    return { rule: 'aria-html', priority: 700 };
  }
  if (label) return { rule: 'aria-html', priority: action === 'submit' ? 720 : 650 };
  return { rule: 'textual-heuristic', priority: 500 };
}

function enabledFormSubmitters(form: HTMLFormElement): (HTMLButtonElement | HTMLInputElement)[] {
  const root = form.getRootNode() as ParentNode;
  return Array.from(root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    'button, input[type="submit"], input[type="image"]',
  )).filter((control) => {
    const tag = control.tagName.toLowerCase();
    return control.form === form
      && !isEffectivelyDisabled(control)
      && (tag !== 'button' || !['button', 'reset'].includes(control.type));
  });
}

function descriptionFor(element: Element, action: DomAction, label: string): string {
  const base = element.getAttribute('data-webmcp-description')
    || `${action} ${label || element.tagName.toLowerCase()}`;
  if (action !== 'submit' || element.tagName.toLowerCase() !== 'form') return base;
  const submitters = enabledFormSubmitters(element as HTMLFormElement);
  if (submitters.length !== 1) return base;
  const submitter = submitters[0]!;
  const submitterLabel = labelOf(submitter) || submitter.tagName.toLowerCase();
  const methodOverride = submitter.getAttribute('formmethod');
  const overrides = [
    methodOverride ? `method ${methodOverride}` : '',
  ].filter(Boolean).join(', ');
  return `${base}. Submits via "${submitterLabel}"${overrides ? ` (${overrides})` : ''}.`;
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
      // This is an application-owned boundary for controls that are useful to
      // people but are implementation details from an agent's perspective.
      if (element.closest('[data-webmcp-ignore]')) continue;
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

export function discoverSemanticUI(
  root: ParentNode,
  options: DiscoveryOptions = {},
): SemanticCompilation {
  const names = new Set<string>();
  const candidateIds = new Set<string>();
  const candidates: SemanticCandidate[] = [];
  const coveredAccessibleOfferRegions: Element[] = [];
  const coveredRepeatedActionControls = new Set<Element>();
  const addCandidate = (
    tool: RuntimeTool,
    element: Element,
    action: DomAction | undefined,
    pattern: string,
    rule: SemanticRule,
    priority: number,
    isExplicit: boolean,
    capabilityKey?: string,
  ): void => {
    const identity = semanticIdentity(
      element,
      action,
      pattern,
      tool.targetUI?.label || '',
      tool.targetUI?.selector || '',
    );
    let id = identity.id;
    let suffix = 2;
    while (candidateIds.has(id)) id = `${identity.id}-${suffix++}`;
    candidateIds.add(id);
    candidates.push({
      id,
      capabilityKey: capabilityKey || identity.key,
      element,
      action,
      pattern,
      rule,
      priority,
      explicit: isExplicit,
      tool: {
        ...tool,
        metadata: {
          ...(tool.metadata ?? {}),
          semanticId: id,
          semanticRule: rule,
          semanticPriority: priority,
        },
      },
    });
  };

  for (const context of contexts(root, options)) {
    try {
      const { element } = context;
      if (isJavaScriptAnchor(element)) continue;
      if (isEffectivelyHidden(element)) continue;
      const isExplicit = explicit(element);
      if (!isExplicit && isAutomaticallyExcluded(element)) continue;
      const repeatedLabel = labelOf(element);
      const repeatedNameSeed = repeatedListNameSeed(element);
      {
        const base = `query.${slug(repeatedNameSeed, 'list')}`;
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
            addCandidate(
              repeated,
              element,
              undefined,
              String(repeated.metadata?.pattern || 'repeated-list'),
              'repeated-structure',
              850,
              false,
            );
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
              const groupedBase = `${groupedTool.name}.${slug(repeatedNameSeed, 'list')}`;
              let groupedName = groupedBase;
              let groupedSuffix = 2;
              while (names.has(groupedName)) groupedName = `${groupedBase}-${groupedSuffix++}`;
              names.add(groupedName);
              addCandidate(
                { ...groupedTool, name: groupedName },
                element,
                'click',
                String(groupedTool.metadata?.pattern || 'repeated-item-action'),
                'repeated-structure',
                840,
                false,
                `${identityKeyForRepeated(name)}|${groupedTool.name}`,
              );
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
      const base = declared
        ? slug(declared, 'tool')
        : `${action}.${slug(
          stableNameSeed(element, label, context.selector),
          element.tagName.toLowerCase() === 'form' && isSearch(element as HTMLFormElement)
            ? 'search'
            : element.tagName.toLowerCase(),
        )}`;
      let name = base;
      let suffix = 2;
      while (names.has(name)) name = `${base}-${suffix++}`;
      names.add(name);
      const targetUI: TargetUI = { selector: context.selector, label: label || undefined, role: element.getAttribute('role') || undefined };
      const provenance = isExplicit ? { source: 'metadata' as const, confidence: 1, sourceId: declared || element.getAttribute('data-webmcp-action') || undefined } : { source: 'discovery' as const, confidence: element.tagName.toLowerCase() === 'form' && isSearch(element as HTMLFormElement) ? 0.95 : 0.9 };
      const semanticPattern = semanticPatternFor(element, action, label);
      const precedence = ruleFor(element, action, label);
      addCandidate({
        name,
        title: label || undefined,
        description: descriptionFor(element, action, label),
        kind: kindFor(action, element),
        inputSchema: inputSchemaFor(action, element),
        outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
        ...(kindFor(action, element) === 'navigation'
          ? {}
          : { annotations: { readOnlyHint: false } }),
        risk: riskFor(action, element, label),
        provenance,
        targetUI,
        metadata: { discovery: 'semantic-control', pattern: semanticPattern },
        lifecycle: 'active',
        status: 'available',
        handler: (input) => executeDomAction(context.root, context.selector, action, input),
      }, element, action, semanticPattern, precedence.rule, precedence.priority, isExplicit);
    } catch {
      // Unsupported or malformed nodes are diagnostic-free and do not stop discovery.
    }
  }
  return compileSemanticCandidates(candidates, options.catalog);
}

function identityKeyForRepeated(name: string): string {
  return `repeated:${name}`;
}

/** Build the inspectable semantic graph used to decide which tools are exposed. */
export function analyzeUI(root: ParentNode, options: DiscoveryOptions = {}): SemanticUIGraph {
  return discoverSemanticUI(root, options).graph;
}

/** Discover and compile the current UI into a deterministic task-level tool catalog. */
export function discoverUI(root: ParentNode, options: DiscoveryOptions = {}): readonly RuntimeTool[] {
  return discoverSemanticUI(root, options).tools;
}

export { executeDomAction, resolveDomTarget } from '../dom/actions.js';
export type { DomAction, DomActionResult } from '../dom/actions.js';
export type { RepeatedListOptions } from './repeated-lists.js';
export type {
  SemanticCatalogOptions,
  SemanticEdgeRelation,
  SemanticExclusionReason,
  SemanticRule,
  SemanticUIEdge,
  SemanticUIGraph,
  SemanticUINode,
} from './semantic-graph.js';
