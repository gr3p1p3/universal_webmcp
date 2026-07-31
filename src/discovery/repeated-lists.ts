import type { JsonObject, JsonValue, RuntimeTool } from '../core/model.js';
import { executeElementAction, resolveDomTarget } from '../dom/actions.js';
import { isEffectivelyDisabled, isEffectivelyHidden } from '../dom/state.js';

export interface RepeatedListOptions {
  /** Discover repeated records in semantic/labelled containers such as div-based result lists. */
  readonly includeStructuralContainers?: boolean;
  /** Load scroll-backed lists to completion when their query tool is invoked. */
  readonly loadAllByDefault?: boolean;
  /** Safety bound for a single lazy-loading query invocation. */
  readonly maxLoadIterations?: number;
  /** Time allowed for each incremental scroll to render more records. */
  readonly settleMs?: number;
}

export interface RepeatedListContext {
  readonly root: ParentNode;
  readonly selector: string;
  readonly element: Element;
  readonly name: string;
  readonly label?: string;
  readonly options?: RepeatedListOptions;
}

export interface RepeatedItemActionDiscovery {
  readonly tools: readonly RuntimeTool[];
  /** Controls represented by the grouped tools and safe to omit as one-tool-per-row duplicates. */
  readonly controls: ReadonlySet<Element>;
}

type RepeatedPattern = {
  readonly kind: 'text' | 'structured';
  readonly childTag?: string;
  readonly childRole?: string;
  readonly fingerprint?: string;
  readonly accessibleOffers?: boolean;
};

type ExpectedCount = {
  readonly value: number;
  readonly source: 'attribute' | 'aria-setsize' | 'heading';
  readonly additional: boolean;
};

const listMarker = /(?:^|[-_\s])(list|results?|offers|items|products|options|angebote|ergebnisse)(?:$|[-_\s])/i;
const pinnedMarker = /(?:^|[-_\s])(pinned|featured)[-_\s]?(offer|item|result)(?:$|[-_\s])/i;
const countHeading = /(\d[\d.,]*)\s+(?:(weitere|other)\s+)?(?:option(?:en|s)?|angebot(?:e)?|offers?|items?|results?|ergebnisse?)/i;
const accessibleOfferLabel = /(?:vom Verkäufer\s+.+?\s+und Preis\s+[\d.,]+\s*€|from seller\s+.+?\s+and price\s+€\s*[\d.,]+)/i;
const cartAction = /(?:add|move)\s+(?:to\s+)?(?:cart|basket|bag)|(?:in den|zum)\s+(?:warenkorb|einkaufswagen)|buy now/i;

function compactText(element: Element): string {
  return (element.textContent || '').trim().replace(/\s+/g, ' ');
}

function markerText(element: Element): string {
  return [
    element.id,
    element.getAttribute('class') || '',
    element.getAttribute('role') || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('data-testid') || '',
  ].join(' ');
}

function structuralMarkerText(element: Element): string {
  return [
    element.id,
    element.getAttribute('class') || '',
    element.getAttribute('role') || '',
    element.getAttribute('data-testid') || '',
  ].join(' ');
}

function stableClasses(element: Element): string {
  return Array.from(element.classList)
    .filter((value) => !/(active|selected|hover|focus|loading|hidden|visible|expanded|collapsed)/i.test(value))
    .sort()
    .join('.');
}

function fingerprint(element: Element): string {
  const id = element.id && !/\d{2,}/.test(element.id) ? element.id : '';
  return [
    element.tagName.toLowerCase(),
    element.getAttribute('role') || '',
    id,
    stableClasses(element),
  ].join('|');
}

function directChildren(element: Element): Element[] {
  return Array.from(element.children).filter((child) => child.nodeType === 1);
}

function repeatedPattern(element: Element, options: RepeatedListOptions): RepeatedPattern | undefined {
  const tag = element.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol') {
    const items = directChildren(element).filter((child) => child.tagName.toLowerCase() === 'li');
    return items.length >= 2 ? { kind: 'text', childTag: 'li' } : undefined;
  }

  if (options.includeStructuralContainers === false) return undefined;
  const role = element.getAttribute('role') || '';
  const semantic = ['list', 'listbox', 'feed', 'grid', 'table'].includes(role)
    || listMarker.test(structuralMarkerText(element));
  if (!semantic) return undefined;

  const offerControls = Array.from(element.querySelectorAll('[aria-label]'))
    .filter((control) => accessibleOfferLabel.test(control.getAttribute('aria-label') || ''));
  if (offerControls.length >= 2) return { kind: 'structured', accessibleOffers: true };

  const children = directChildren(element);
  const roleItems = children.filter((child) => ['listitem', 'option', 'row', 'article'].includes(child.getAttribute('role') || ''));
  if (roleItems.length >= 2) {
    return { kind: 'structured', childRole: roleItems[0]?.getAttribute('role') || undefined };
  }

  const groups = new Map<string, Element[]>();
  for (const child of children) {
    const key = fingerprint(child);
    const group = groups.get(key) ?? [];
    group.push(child);
    groups.set(key, group);
  }
  const repeated = [...groups.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort((left, right) => right[1].length - left[1].length)[0];
  return repeated ? { kind: 'structured', fingerprint: repeated[0] } : undefined;
}

function recordsFor(element: Element, pattern: RepeatedPattern): Element[] {
  if (pattern.accessibleOffers) {
    const controls = Array.from(element.querySelectorAll('[aria-label]'))
      .filter((control) => accessibleOfferLabel.test(control.getAttribute('aria-label') || ''));
    return uniqueElements(controls.map((control) => (
      control.closest('[id*="offer" i], [class*="offer" i], [role="listitem"], article') || control
    )));
  }
  const children = directChildren(element);
  if (pattern.childTag) return children.filter((child) => child.tagName.toLowerCase() === pattern.childTag);
  if (pattern.childRole) return children.filter((child) => child.getAttribute('role') === pattern.childRole);
  return children.filter((child) => fingerprint(child) === pattern.fingerprint);
}

function actionLabel(element: Element): string {
  return (
    element.getAttribute('aria-label')
    || element.getAttribute('title')
    || (element.textContent || '')
  ).trim().replace(/\s+/g, ' ').slice(0, 80);
}

function actionSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function actionIntent(element: Element): { key: string; label: string } {
  const label = actionLabel(element);
  if (cartAction.test(label)) return { key: 'cart:add', label: 'Add to cart' };
  return { key: label.toLowerCase(), label };
}

function repeatedActionControls(record: Element): Element[] {
  const candidates = [
    record,
    ...Array.from(record.querySelectorAll(
      'button, input[type="button"], input[type="submit"], input[type="image"], [role="button"]',
    )),
  ];
  return uniqueElements(candidates).filter((candidate) => (
    candidate.matches('button, input[type="button"], input[type="submit"], input[type="image"], [role="button"]')
    &&
    actionLabel(candidate).length > 0
    && !isEffectivelyHidden(candidate)
    && !isEffectivelyDisabled(candidate)
  ));
}

function repeatedActionError(error: string, index?: number): JsonObject {
  return index === undefined
    ? { status: 'error', error }
    : { status: 'error', error, index };
}

function closestCollectionScope(element: Element): Element {
  return element.closest('[role="dialog"], dialog, section, main') || element.parentElement || element;
}

function pinnedRecords(element: Element): Element[] {
  if (!/(offer|angebot)/i.test(markerText(element))) return [];
  const scope = closestCollectionScope(element);
  const candidates = Array.from(scope.querySelectorAll('*')).filter((candidate) => (
    pinnedMarker.test(markerText(candidate))
    && !!candidate.querySelector('input[aria-label], button[aria-label], [data-webmcp-field]')
  ));
  return uniqueRecords(
    candidates.filter((candidate) => !candidates.some((parent) => parent !== candidate && parent.contains(candidate))),
  );
}

function uniqueElements(elements: readonly Element[]): Element[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

function uniqueRecords(elements: readonly Element[]): Element[] {
  const seen = new Set<string>();
  return uniqueElements(elements).filter((element, index) => {
    const accessible = parseAccessibleOfferLabel(element);
    const key = accessible.seller && accessible.price
      ? `${accessible.seller.toLowerCase()}|${accessible.price.replace(/\s+/g, '')}`
      : `element:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attributeExpectedCount(element: Element): ExpectedCount | undefined {
  for (const name of ['data-webmcp-total-count', 'data-total-count', 'data-count']) {
    const value = Number.parseInt(element.getAttribute(name) || '', 10);
    if (Number.isFinite(value) && value >= 0) return { value, source: 'attribute', additional: false };
  }
  const ariaSizes = Array.from(element.querySelectorAll('[aria-setsize]'))
    .map((item) => Number.parseInt(item.getAttribute('aria-setsize') || '', 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (ariaSizes.length > 0) return { value: Math.max(...ariaSizes), source: 'aria-setsize', additional: false };
  return undefined;
}

function headingExpectedCount(element: Element): ExpectedCount | undefined {
  const scope = closestCollectionScope(element);
  for (const heading of Array.from(scope.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))) {
    const match = compactText(heading).match(countHeading);
    if (!match) continue;
    const value = Number.parseInt(match[1]!.replace(/[.,]/g, ''), 10);
    if (Number.isFinite(value)) return { value, source: 'heading', additional: !!match[2] };
  }
  return undefined;
}

function expectedCount(element: Element, pinnedCount: number): ExpectedCount | undefined {
  const declared = attributeExpectedCount(element) ?? headingExpectedCount(element);
  if (!declared) return undefined;
  return {
    ...declared,
    value: declared.value + (declared.additional ? pinnedCount : 0),
  };
}

function fieldMarker(element: Element): string {
  return [
    element.getAttribute('data-webmcp-field') || '',
    element.id,
    element.getAttribute('class') || '',
    element.getAttribute('data-testid') || '',
    element.getAttribute('aria-label') || '',
  ].join(' ');
}

function firstField(record: Element, include: RegExp, exclude?: RegExp): string | undefined {
  const candidates = [record, ...Array.from(record.querySelectorAll('*'))].filter((candidate) => {
    const marker = fieldMarker(candidate);
    return include.test(marker) && !(exclude?.test(marker) ?? false) && compactText(candidate).length > 0;
  });
  const smallest = candidates.sort((left, right) => compactText(left).length - compactText(right).length)[0];
  return smallest ? compactText(smallest) : undefined;
}

function parseAccessibleOfferLabel(record: Element): { seller?: string; price?: string } {
  const labels = Array.from(record.querySelectorAll('[aria-label]'))
    .map((element) => element.getAttribute('aria-label') || '');
  for (const label of labels) {
    const german = label.match(/vom Verkäufer\s+(.+?)\s+und Preis\s+([\d.,]+\s*€)/i);
    if (german) return { seller: german[1]?.trim(), price: german[2]?.trim() };
    const english = label.match(/from seller\s+(.+?)\s+and price\s+(€\s*[\d.,]+)/i);
    if (english) return { seller: english[1]?.trim(), price: english[2]?.replace(/\s+/g, '') };
  }
  return {};
}

function normalizeSeller(value: string | undefined): string | undefined {
  return value?.replace(/^(?:sold by|seller|verkauf durch|verkäufer)\s*:?\s*/i, '').trim() || undefined;
}

function priceFrom(value: string | undefined): string | undefined {
  return value?.match(/(?:€\s*[\d.,]+|[\d.,]+\s*€)/)?.[0]?.replace(/\s+/g, ' ').trim();
}

function structuredRecord(record: Element): JsonObject {
  const accessible = parseAccessibleOfferLabel(record);
  const seller = normalizeSeller(
    firstField(record, /(?:sold.?by|seller|merchant|vendor|verk[aä]ufer|haendler|händler)/i)
    ?? accessible.seller,
  );
  const price = priceFrom(firstField(record, /(?:price|preis)/i, /(?:shipping|delivery|versand)/i))
    ?? accessible.price;
  const fields: Record<string, JsonValue> = {};
  if (seller) fields.seller = seller;
  if (price) fields.price = price;
  const explicitFields = Array.from(record.querySelectorAll('[data-webmcp-field]'));
  for (const field of explicitFields) {
    const name = field.getAttribute('data-webmcp-field')?.trim();
    const value = compactText(field);
    if (name && value) fields[name] = value;
  }
  return {
    text: compactText(record),
    fields,
  };
}

function findScrollableAncestor(element: Element, records: readonly Element[] = []): HTMLElement | undefined {
  const candidates: HTMLElement[] = [];
  for (const origin of [element, ...records]) {
    let current: Element | null = origin;
    while (current) {
      const candidate = current as HTMLElement;
      if (candidate.scrollHeight > candidate.clientHeight + 1 && candidate.clientHeight > 0) candidates.push(candidate);
      if (current === element) break;
      current = current.parentElement;
    }
  }
  if (candidates.length === 0) {
    candidates.push(...Array.from(element.querySelectorAll('*'))
      .map((candidate) => candidate as HTMLElement)
      .filter((candidate) => candidate.scrollHeight > candidate.clientHeight + 1 && candidate.clientHeight > 0));
  }
  return uniqueElements(candidates).sort((left, right) => {
    const leftNamed = /scroll|viewport/i.test(markerText(left)) ? 1 : 0;
    const rightNamed = /scroll|viewport/i.test(markerText(right)) ? 1 : 0;
    return rightNamed - leftNamed
      || (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight);
  })[0] as HTMLElement | undefined;
}

function numberInput(input: JsonObject, name: string, fallback: number, maximum: number): number {
  const value = input[name];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.floor(value)))
    : fallback;
}

function booleanInput(input: JsonObject, name: string, fallback: boolean): boolean {
  return typeof input[name] === 'boolean' ? input[name] as boolean : fallback;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAllRecords(
  root: ParentNode,
  selector: string,
  pattern: RepeatedPattern,
  options: RepeatedListOptions,
  input: JsonObject,
): Promise<JsonObject> {
  let current = resolveDomTarget(root, selector);
  if (!current) return { status: 'error', error: 'target-not-found' };
  const loadAll = booleanInput(input, 'loadAll', options.loadAllByDefault !== false);
  const maxIterations = numberInput(input, 'maxIterations', options.maxLoadIterations ?? 30, 100);
  const settleMs = numberInput(input, 'settleMs', options.settleMs ?? 350, 5_000);
  let iterations = 0;
  let stableAtEnd = 0;
  let exhausted = false;

  while (loadAll && iterations < maxIterations) {
    const pinned = pinnedRecords(current);
    const records = uniqueRecords([...pinned, ...recordsFor(current, pattern)]);
    const expected = expectedCount(current, pinned.length);
    if (expected && records.length >= expected.value) break;
    const scroller = findScrollableAncestor(current, records);
    if (!scroller) {
      exhausted = true;
      break;
    }
    const before = { count: records.length, top: scroller.scrollTop, height: scroller.scrollHeight };
    const increment = Math.max(300, scroller.clientHeight * 0.8);
    if (typeof scroller.scrollBy === 'function') scroller.scrollBy({ top: increment, behavior: 'auto' });
    else scroller.scrollTop += increment;
    scroller.dispatchEvent(new Event('scroll'));
    iterations += 1;
    if (settleMs > 0) await pause(settleMs);
    current = resolveDomTarget(root, selector);
    if (!current) return { status: 'error', error: 'target-not-found' };
    const afterRecords = uniqueRecords([...pinnedRecords(current), ...recordsFor(current, pattern)]);
    const afterScroller = findScrollableAncestor(current, afterRecords);
    if (!afterScroller) {
      exhausted = true;
      break;
    }
    const afterCount = afterRecords.length;
    const atEnd = afterScroller.scrollTop + afterScroller.clientHeight >= afterScroller.scrollHeight - 1;
    const unchanged = afterCount === before.count
      && afterScroller.scrollTop === before.top
      && afterScroller.scrollHeight === before.height;
    stableAtEnd = atEnd && unchanged ? stableAtEnd + 1 : 0;
    if (stableAtEnd >= 2 && !expectedCount(current, pinnedRecords(current).length)) {
      exhausted = true;
      break;
    }
  }

  const pinned = pinnedRecords(current);
  const records = uniqueRecords([...pinned, ...recordsFor(current, pattern)]);
  const expected = expectedCount(current, pinned.length);
  const complete = expected ? records.length === expected.value : exhausted || !findScrollableAncestor(current, records);
  const items: JsonValue[] = pattern.kind === 'text'
    ? records.map((record) => compactText(record))
    : records.map(structuredRecord);
  return {
    status: 'ok',
    items,
    completeness: {
      expectedCount: expected?.value ?? null,
      collectedCount: records.length,
      complete,
      source: expected?.source ?? (complete ? 'scroll-exhausted' : 'unknown'),
      iterations,
    },
  };
}

export function createRepeatedListTool(context: RepeatedListContext): RuntimeTool | undefined {
  const options = context.options ?? {};
  const pattern = repeatedPattern(context.element, options);
  if (!pattern) return undefined;
  const structured = pattern.kind === 'structured';
  return {
    name: context.name,
    description: `Read all repeated items from ${context.label || 'list'} and report completeness`,
    kind: 'query',
    inputSchema: {
      type: 'object',
      properties: {
        loadAll: { type: 'boolean', default: true },
        maxIterations: { type: 'integer', minimum: 0, maximum: 100 },
        settleMs: { type: 'integer', minimum: 0, maximum: 5_000 },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        items: { type: 'array', items: structured ? { type: 'object' } : { type: 'string' } },
        completeness: {
          type: 'object',
          properties: {
            expectedCount: { type: ['integer', 'null'] },
            collectedCount: { type: 'integer' },
            complete: { type: 'boolean' },
            source: { type: 'string' },
            iterations: { type: 'integer' },
          },
        },
      },
    },
    annotations: { readOnlyHint: true },
    risk: { level: 'low' },
    provenance: { source: 'discovery', confidence: structured ? 0.8 : 0.85 },
    targetUI: { selector: context.selector, label: context.label },
    metadata: {
      discovery: 'repeated-list',
      structured,
      lazyLoad: true,
      recordScope: pattern.accessibleOffers ? 'accessible-offers' : 'direct-children',
    },
    lifecycle: 'active',
    status: 'available',
    handler: (input) => readAllRecords(context.root, context.selector, pattern, options, input),
  };
}

/**
 * Collapses controls repeated once per record into one parameterized tool.
 * The companion query tool provides the stable zero-based record order.
 */
export function createRepeatedItemActionTools(
  context: RepeatedListContext,
): RepeatedItemActionDiscovery {
  const options = context.options ?? {};
  const pattern = repeatedPattern(context.element, options);
  if (!pattern) return { tools: Object.freeze([]), controls: new Set<Element>() };

  const records = uniqueRecords([
    ...pinnedRecords(context.element),
    ...recordsFor(context.element, pattern),
  ]);
  const groups = new Map<string, { label: string; controls: Element[]; recordIndexes: Set<number> }>();
  records.forEach((record, recordIndex) => {
    for (const control of repeatedActionControls(record)) {
      const intent = actionIntent(control);
      const group = groups.get(intent.key) ?? {
        label: intent.label,
        controls: [],
        recordIndexes: new Set<number>(),
      };
      group.controls.push(control);
      group.recordIndexes.add(recordIndex);
      groups.set(intent.key, group);
    }
  });

  const represented = new Set<Element>();
  const tools: RuntimeTool[] = [];
  for (const [key, group] of groups) {
    if (group.recordIndexes.size < 2) continue;
    for (const control of group.controls) represented.add(control);
    const cart = cartAction.test(group.label);
    tools.push({
      name: `item.${actionSlug(group.label)}`,
      description: `${group.label} for one item from ${context.label || 'the repeated list'}`,
      kind: 'action',
      inputSchema: {
        type: 'object',
        required: ['index'],
        properties: {
          index: { type: 'integer', minimum: 0 },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          action: { type: 'string' },
          selector: { type: 'string' },
        },
      },
      risk: cart
        ? { level: 'medium', requiresConfirmation: true }
        : { level: 'low' },
      provenance: { source: 'discovery', confidence: 0.9 },
      targetUI: { selector: context.selector, label: group.label },
      metadata: {
        discovery: 'repeated-item-action',
        pattern: cart ? 'cart' : 'repeated-action',
        recordQuery: context.name,
        indexBase: 0,
      },
      lifecycle: 'active',
      status: 'available',
      handler: (input) => {
        const index = input.index;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
          return repeatedActionError('index-must-be-non-negative-integer');
        }
        const current = resolveDomTarget(context.root, context.selector);
        if (!current) return repeatedActionError('target-not-found');
        const currentRecords = uniqueRecords([
          ...pinnedRecords(current),
          ...recordsFor(current, pattern),
        ]);
        const record = currentRecords[index];
        if (!record) return repeatedActionError('record-not-found', index);
        const control = repeatedActionControls(record)
          .find((candidate) => actionIntent(candidate).key === key);
        if (!control) return repeatedActionError('record-action-not-found', index);
        return executeElementAction(
          control,
          `${context.selector}::item(${index})::${actionSlug(group.label)}`,
          'click',
        );
      },
    });
  }

  return { tools: Object.freeze(tools), controls: represented };
}
