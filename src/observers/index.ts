export interface DomObserverOptions {
  readonly debounceMs?: number;
  /** Alias kept for callers that use the shorter option name. */
  readonly debounce?: number;
  readonly observeAttributes?: boolean;
  readonly attributeFilter?: readonly string[];
}

export interface RuntimeObserverOptions extends DomObserverOptions {
  readonly observeNavigation?: boolean;
}

/**
 * Adapter boundary for application state that can change capabilities without
 * producing an observable DOM mutation (for example a client-side store).
 */
export interface RuntimeInvalidationSource {
  subscribe(callback: () => void): void | (() => void);
}

export interface DisposableObserver {
  start(): void;
  stop(): void;
}

type ObserverWindow = Window & {
  history: History;
};

const semanticAttributes = [
  'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'aria-selected',
  'aria-expanded', 'aria-checked', 'aria-pressed', 'aria-current', 'aria-busy',
  'aria-setsize', 'role', 'title', 'name', 'type', 'value', 'placeholder',
  'checked', 'disabled', 'hidden', 'inert', 'href', 'rel', 'id', 'class', 'style',
  'data-testid', 'data-webmcp-tool', 'data-webmcp-action',
  'data-webmcp-description', 'data-webmcp-total-count', 'data-webmcp-busy',
  'data-total-count', 'data-count',
];

type Debounced = (() => void) & { cancel(): void };

/** Bridge one or more application events into the runtime invalidation contract. */
export function createEventInvalidationSource(
  target: EventTarget,
  eventNames: readonly string[] = ['webmcp:invalidate'],
): RuntimeInvalidationSource {
  const names = [...new Set(eventNames.map((name) => name.trim()).filter(Boolean))];
  return {
    subscribe(callback): () => void {
      for (const name of names) target.addEventListener(name, callback);
      return () => {
        for (const name of names) target.removeEventListener(name, callback);
      };
    },
  };
}

function schedule(callback: () => void, delay: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invoke = function (): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      callback();
    }, delay);
  } as Debounced;
  invoke.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return invoke;
}

function resolveWindow(root: ParentNode): ObserverWindow | undefined {
  const document = root.nodeType === 9 ? root as Document : root.ownerDocument;
  const view = document?.defaultView;
  return view && typeof view.addEventListener === 'function' && view.history ? view : undefined;
}

function elements(root: ParentNode): Element[] {
  const own = root.nodeType === 1 ? [root as Element] : [];
  try { return [...own, ...Array.from(root.querySelectorAll('*'))]; } catch { return own; }
}

function nestedRoots(root: ParentNode): ParentNode[] {
  const result: ParentNode[] = [];
  for (const element of elements(root)) {
    if (element.shadowRoot) result.push(element.shadowRoot);
    if (element.tagName.toLowerCase() === 'iframe') {
      try {
        const frame = element as HTMLIFrameElement;
        if (frame.contentDocument) result.push(frame.contentDocument);
      } catch {
        // Accessing a cross-origin frame throws; it is intentionally ignored.
      }
    }
  }
  return result;
}

/** Small, disposable DOM invalidation observer. It never forwards mutation data. */
export class DomObserver implements DisposableObserver {
  private readonly observers = new Map<ParentNode, MutationObserver>();
  private readonly frameLoadListeners = new Map<HTMLIFrameElement, EventListener>();
  private readonly debounceNotify: Debounced;
  private readonly attributeOptions: DomObserverOptions;
  private running = false;

  public constructor(
    private readonly root: ParentNode | undefined,
    callback: () => void,
    options: DomObserverOptions = {},
  ) {
    this.debounceNotify = schedule(callback, Math.max(0, options.debounceMs ?? options.debounce ?? 50));
    this.attributeOptions = options;
  }

  private observeRoot(root: ParentNode): void {
    if (!this.running || this.observers.has(root) || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeType === 1) this.attachNested(node as Element);
        }
      }
      this.reconcileNestedRoots();
      this.debounceNotify();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: this.attributeOptions.observeAttributes !== false,
      attributeFilter: this.attributeOptions.observeAttributes === false
        ? undefined
        : [...(this.attributeOptions.attributeFilter ?? semanticAttributes)],
    });
    this.observers.set(root, observer);
  }

  private attachFrameListener(element: HTMLIFrameElement): void {
    if (this.frameLoadListeners.has(element)) return;
    const listener: EventListener = () => {
      try {
        if (element.contentDocument) this.attachRootTree(element.contentDocument);
      } catch {
        // Cross-origin frames remain outside the observation graph.
      }
      this.debounceNotify();
    };
    element.addEventListener('load', listener);
    this.frameLoadListeners.set(element, listener);
  }

  private attachNested(element: Element): void {
    if (element.tagName.toLowerCase() === 'iframe') this.attachFrameListener(element as HTMLIFrameElement);
    // Ordinary elements remain covered by their existing parent observer. Only
    // special DOM roots get their own MutationObserver.
    for (const nested of nestedRoots(element)) this.attachRootTree(nested);
  }

  private attachRootTree(root: ParentNode): void {
    if (!this.running) return;
    this.observeRoot(root);
    for (const nested of nestedRoots(root)) this.attachRootTree(nested);
  }

  private reachableNestedRoots(): Set<ParentNode> {
    const reachable = new Set<ParentNode>();
    const visit = (root: ParentNode): void => {
      for (const nested of nestedRoots(root)) {
        if (reachable.has(nested)) continue;
        reachable.add(nested);
        visit(nested);
      }
    };
    if (this.root) visit(this.root);
    return reachable;
  }

  private reconcileNestedRoots(): void {
    if (!this.running || !this.root) return;
    const reachable = this.reachableNestedRoots();
    for (const nested of reachable) this.attachRootTree(nested);
    for (const [observedRoot, observer] of this.observers) {
      if (observedRoot === this.root || reachable.has(observedRoot)) continue;
      observer.disconnect();
      this.observers.delete(observedRoot);
    }
    const reachableFrames = new Set<HTMLIFrameElement>();
    const roots = [this.root, ...reachable];
    for (const root of roots) {
      for (const element of elements(root)) {
        if (element.tagName.toLowerCase() === 'iframe') {
          const frame = element as HTMLIFrameElement;
          reachableFrames.add(frame);
          this.attachFrameListener(frame);
        }
      }
    }
    for (const [frame, listener] of this.frameLoadListeners) {
      if (reachableFrames.has(frame)) continue;
      frame.removeEventListener('load', listener);
      this.frameLoadListeners.delete(frame);
    }
  }

  public start(): void {
    if (this.running || !this.root || typeof MutationObserver === 'undefined') return;
    this.running = true;
    this.attachRootTree(this.root);
    this.reconcileNestedRoots();
  }

  public stop(): void {
    if (!this.running && this.observers.size === 0) return;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const [frame, listener] of this.frameLoadListeners) frame.removeEventListener('load', listener);
    this.frameLoadListeners.clear();
    this.debounceNotify.cancel();
    this.running = false;
  }
}

interface HistoryPatch {
  readonly originalPushState: History['pushState'];
  readonly originalReplaceState: History['replaceState'];
  readonly listeners: Set<() => void>;
}

const historyPatches = new WeakMap<History, HistoryPatch>();

function addHistoryListener(view: ObserverWindow, listener: () => void): (() => void) | undefined {
  const history = view.history;
  let patch = historyPatches.get(history);
  if (!patch) {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const listeners = new Set<() => void>();
    patch = { originalPushState, originalReplaceState, listeners };
    const notify = (): void => {
      for (const callback of listeners) {
        try { callback(); } catch { /* observer callbacks must not break history */ }
      }
    };
    try {
      history.pushState = function (this: History, ...args: Parameters<History['pushState']>): ReturnType<History['pushState']> {
        const result = originalPushState.apply(this, args);
        notify();
        return result;
      };
      history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>): ReturnType<History['replaceState']> {
        const result = originalReplaceState.apply(this, args);
        notify();
        return result;
      };
      historyPatches.set(history, patch);
    } catch {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      return undefined;
    }
  }
  patch.listeners.add(listener);
  return () => {
    const current = historyPatches.get(history);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size !== 0) return;
    history.pushState = current.originalPushState;
    history.replaceState = current.originalReplaceState;
    historyPatches.delete(history);
  };
}

/** DOM observer plus browser navigation invalidation. */
export class RuntimeObserver implements DisposableObserver {
  private readonly dom: DomObserver;
  private readonly window: ObserverWindow | undefined;
  private readonly onNavigation: () => void;
  private readonly navigationNotify: Debounced;
  private readonly observeNavigation: boolean;
  private removeHistoryListener: (() => void) | undefined;
  private running = false;

  public constructor(
    root: ParentNode | undefined,
    callback: () => void,
    options: RuntimeObserverOptions = {},
  ) {
    this.dom = new DomObserver(root, callback, options);
    this.window = root ? resolveWindow(root) : undefined;
    this.navigationNotify = schedule(callback, Math.max(0, options.debounceMs ?? options.debounce ?? 50));
    this.onNavigation = () => this.navigationNotify();
    this.observeNavigation = options.observeNavigation !== false;
  }

  public start(): void {
    if (this.running) return;
    this.dom.start();
    if (this.observeNavigation && this.window) {
      this.window.addEventListener('popstate', this.onNavigation);
      this.window.addEventListener('hashchange', this.onNavigation);
      this.removeHistoryListener = addHistoryListener(this.window, this.onNavigation);
    }
    this.running = true;
  }

  public stop(): void {
    if (!this.running) return;
    this.dom.stop();
    if (this.observeNavigation && this.window) {
      this.window.removeEventListener('popstate', this.onNavigation);
      this.window.removeEventListener('hashchange', this.onNavigation);
    }
    this.removeHistoryListener?.();
    this.removeHistoryListener = undefined;
    this.navigationNotify.cancel();
    this.running = false;
  }
}
