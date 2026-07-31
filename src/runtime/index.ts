import { CapabilityRegistry } from '../core/registry.js';
import { RuntimeDestroyedError } from '../core/errors.js';
import type { JsonObject, JsonValue, RuntimeMode, RuntimeTool, RuntimeToolDescriptor, RuntimeToolHandler } from '../core/model.js';
import {
  discoverSemanticUI,
  type DiscoveryOptions,
  type SemanticUIGraph,
} from '../discovery/index.js';
import {
  evaluateToolPolicy,
  type ConfirmationPolicy,
  type PolicyEvaluation,
  type PolicyReason,
  type RiskPolicyConfig,
} from '../policy/index.js';
import {
  BrowserModelContextAdapter,
  type ModelContextAdapter,
  type UserInteractionRequest,
} from '../platform/index.js';
import {
  RuntimeObserver,
  type RuntimeInvalidationSource,
  type RuntimeObserverOptions,
} from '../observers/index.js';

export interface RuntimeSynchronizationOptions {
  /** Wait for DOM/application invalidations after form and action invocations. Defaults to true. */
  readonly waitAfterInvoke?: boolean;
  /** Quiet period required before the runtime is considered synchronized. Defaults to 100ms. */
  readonly settleMs?: number;
  /** Maximum post-invocation wait. Defaults to 2 seconds. */
  readonly timeoutMs?: number;
  /** Elements matching this selector keep the runtime busy. */
  readonly busySelector?: string;
}

export interface RuntimeWaitOptions {
  readonly settleMs?: number;
  readonly timeoutMs?: number;
}

export interface RuntimeSynchronizationResult {
  readonly status: 'idle' | 'timeout';
  readonly revision: number;
  readonly elapsedMs: number;
}

export interface WebMCPRuntimeOptions {
  readonly root?: ParentNode;
  readonly adapter?: ModelContextAdapter;
  readonly mode?: RuntimeMode;
  readonly confirmationPolicy?: ConfirmationPolicy;
  readonly policy?: RiskPolicyConfig;
  readonly policyConfig?: RiskPolicyConfig;
  readonly discovery?: DiscoveryOptions;
  readonly discoveryOptions?: DiscoveryOptions;
  readonly initialTools?: readonly RuntimeTool[];
  readonly autoDiscover?: boolean;
  readonly autoStart?: boolean;
  readonly observe?: boolean;
  readonly observerOptions?: RuntimeObserverOptions;
  readonly invalidationSources?: readonly RuntimeInvalidationSource[];
  readonly synchronization?: RuntimeSynchronizationOptions;
}

export type RuntimeDiagnosticCode =
  | 'platform-unavailable'
  | 'platform-registration-failed'
  | 'platform-unregistration-failed'
  | 'discovery-failed'
  | 'tool-registration-failed'
  | 'confirmation-unavailable'
  | 'confirmation-rejected'
  | 'invalidation-source-failed'
  | 'synchronization-timeout'
  | 'tool-denied'
  | 'tool-not-found'
  | 'tool-failed';

export interface RuntimeDiagnostic {
  readonly code: RuntimeDiagnosticCode;
  readonly message: string;
  readonly toolName?: string;
  readonly reasons?: readonly PolicyReason[];
}

export interface WebMCPRuntime {
  readonly mode: RuntimeMode;
  readonly diagnostics: readonly RuntimeDiagnostic[];
  start(): void;
  stop(): void;
  isRunning(): boolean;
  destroy(): void;
  registerTool(tool: RuntimeTool): RuntimeToolDescriptor;
  unregisterTool(name: string): boolean;
  discover(): readonly RuntimeToolDescriptor[];
  /** Immediately reconciles inferred tools with the current UI. */
  refresh(): readonly RuntimeToolDescriptor[];
  /** Waits until invalidations are reconciled and the configured busy state is clear. */
  waitForIdle(options?: RuntimeWaitOptions): Promise<RuntimeSynchronizationResult>;
  /** Waits for a named capability to become available, returning undefined on timeout. */
  waitForTool(name: string, options?: RuntimeWaitOptions): Promise<RuntimeToolDescriptor | undefined>;
  /** Returns metadata only; handlers are intentionally not exposed. */
  listTools(): readonly RuntimeToolDescriptor[];
  /** Returns the latest automatic discovery graph, including excluded candidates. */
  getSemanticGraph(): SemanticUIGraph | undefined;
  /** Invokes a registered tool through the same policy guardrail used by the platform. */
  invokeTool(name: string, input: JsonObject): Promise<JsonValue>;
  getPolicyDecision(tool: RuntimeTool | string): PolicyEvaluation | undefined;
}

function defaultRoot(): ParentNode | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  const candidate = (globalThis as { document?: unknown }).document;
  return candidate && typeof candidate === 'object' && 'querySelectorAll' in candidate
    ? candidate as ParentNode
    : undefined;
}

function jsonError(code: RuntimeDiagnosticCode, message: string): JsonObject {
  return { status: 'blocked', code, error: message };
}

function interactionRequest(tool: RuntimeTool, evaluation: PolicyEvaluation): UserInteractionRequest {
  return {
    type: 'webmcp-confirmation',
    toolName: tool.name,
    description: tool.description,
    risk: tool.risk.level,
    reasons: evaluation.reasons.map((item) => ({ code: item.code, message: item.message })),
  };
}

function confirmed(result: JsonObject): boolean {
  return result.confirmed === true || result.approved === true;
}

function safeHandler(handler: RuntimeToolHandler, input: JsonObject): Promise<JsonValue> {
  return Promise.resolve().then(() => handler(input)).catch(() => jsonError('tool-failed', 'Tool execution failed.'));
}

function descriptorOf(tool: RuntimeTool): RuntimeToolDescriptor {
  const descriptor = { ...tool } as { -readonly [K in keyof RuntimeTool]?: RuntimeTool[K] };
  delete descriptor.handler;
  return Object.freeze(descriptor as RuntimeToolDescriptor);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function discoveredToolFingerprint(tool: RuntimeTool): string {
  return stableStringify(descriptorOf(tool));
}

export function createWebMCPRuntime(options: WebMCPRuntimeOptions = {}): WebMCPRuntime {
  const mode = options.mode ?? 'hybrid';
  const adapter = options.adapter ?? new BrowserModelContextAdapter();
  const registry = new CapabilityRegistry();
  const diagnostics: RuntimeDiagnostic[] = [];
  const platformRegistrations = new Map<string, symbol>();
  const discoveredTools = new Map<string, string>();
  const policyConfig: RiskPolicyConfig = {
    ...(options.policy ?? options.policyConfig ?? {}),
    ...(options.confirmationPolicy === undefined ? {} : { confirmationPolicy: options.confirmationPolicy }),
  };
  const root = options.root ?? defaultRoot();
  const discoveryOptions = options.discovery ?? options.discoveryOptions ?? {};
  const autoDiscover = options.autoDiscover ?? true;
  const observe = options.observe ?? (autoDiscover && !!root);
  const synchronization = {
    waitAfterInvoke: options.synchronization?.waitAfterInvoke !== false,
    settleMs: Math.max(0, options.synchronization?.settleMs ?? 100),
    timeoutMs: Math.max(0, options.synchronization?.timeoutMs ?? 2_000),
    busySelector: options.synchronization?.busySelector
      ?? '[aria-busy="true"], [data-webmcp-busy="true"]',
  };
  let running = false;
  let destroyed = false;
  let observer: RuntimeObserver | undefined;
  let rescanScheduled = false;
  let rescanRunning = false;
  let syncRevision = 0;
  let lastInvalidation = Date.now();
  let invalidationCleanups: (() => void)[] = [];
  let semanticGraph: SemanticUIGraph | undefined;

  const addDiagnostic = (diagnostic: RuntimeDiagnostic): void => { diagnostics.push(diagnostic); };

  const policyFor = (tool: RuntimeTool): PolicyEvaluation => evaluateToolPolicy(tool, mode, policyConfig);

  const invokeThroughPolicy = async (tool: RuntimeTool, input: JsonObject): Promise<JsonValue> => {
    const evaluation = policyFor(tool);
    if (evaluation.decision === 'deny') {
      addDiagnostic({ code: 'tool-denied', message: 'Tool invocation denied by policy.', toolName: tool.name, reasons: evaluation.reasons });
      return { ...jsonError('tool-denied', 'Tool invocation denied by policy.'), reasons: evaluation.reasons.map((item) => item.code) };
    }
    if (evaluation.decision === 'confirm') {
      if (!adapter.requestUserInteraction) {
        addDiagnostic({ code: 'confirmation-unavailable', message: 'User confirmation is unavailable.', toolName: tool.name, reasons: evaluation.reasons });
        return jsonError('confirmation-unavailable', 'User confirmation is unavailable.');
      }
      try {
        const result = await adapter.requestUserInteraction(interactionRequest(tool, evaluation));
        if (!confirmed(result)) {
          addDiagnostic({ code: 'confirmation-rejected', message: 'User confirmation was not granted.', toolName: tool.name, reasons: evaluation.reasons });
          return jsonError('confirmation-rejected', 'User confirmation was not granted.');
        }
      } catch {
        addDiagnostic({ code: 'confirmation-unavailable', message: 'User confirmation failed.', toolName: tool.name, reasons: evaluation.reasons });
        return jsonError('confirmation-unavailable', 'User confirmation failed.');
      }
    }
    const result = await safeHandler(tool.handler, input);
    if (synchronization.waitAfterInvoke && (tool.kind === 'action' || tool.kind === 'form')) {
      rescan();
      const sync = await waitForIdleInternal();
      if (sync.status === 'timeout') {
        addDiagnostic({
          code: 'synchronization-timeout',
          message: 'The UI did not reach an idle synchronized state before the timeout.',
          toolName: tool.name,
        });
      }
    }
    return result;
  };

  const wrappedTool = (tool: RuntimeTool): RuntimeTool => ({
    ...tool,
    handler: (input): Promise<JsonValue> => invokeThroughPolicy(tool, input),
  });

  const registerPlatform = (tool: RuntimeTool): void => {
    if (!running || platformRegistrations.has(tool.name)) return;
    const evaluation = policyFor(tool);
    if (evaluation.decision === 'deny') {
      addDiagnostic({ code: 'tool-denied', message: 'Tool was not registered because policy denied it.', toolName: tool.name, reasons: evaluation.reasons });
      return;
    }
    if (!adapter.isAvailable()) {
      addDiagnostic({ code: 'platform-unavailable', message: 'WebMCP platform is unavailable; tool remains available locally.', toolName: tool.name });
      return;
    }
    const registration = Symbol(tool.name);
    platformRegistrations.set(tool.name, registration);
    try {
      const result = adapter.registerTool(wrappedTool(tool));
      if (!result.ready) return;
      void Promise.resolve(result.ready).catch(() => {
        if (platformRegistrations.get(tool.name) !== registration) return;
        platformRegistrations.delete(tool.name);
        addDiagnostic({ code: 'platform-registration-failed', message: 'Tool could not be registered on the platform.', toolName: tool.name });
      });
    } catch {
      platformRegistrations.delete(tool.name);
      addDiagnostic({ code: 'platform-registration-failed', message: 'Tool could not be registered on the platform.', toolName: tool.name });
    }
  };

  const unregisterPlatform = (name: string): void => {
    if (!platformRegistrations.has(name)) return;
    try {
      adapter.unregisterTool(name);
      platformRegistrations.delete(name);
    } catch {
      addDiagnostic({ code: 'platform-unregistration-failed', message: 'Tool could not be removed from the platform.', toolName: name });
    }
  };

  // The registry is the source of truth. Every mutation, whether explicit or
  // discovered, reaches the platform through this single synchronization path.
  registry.subscribe((event) => {
    if (!running) return;
    if (event.type === 'clear') {
      for (const name of [...platformRegistrations.keys()]) unregisterPlatform(name);
      return;
    }
    if (!event.name) return;
    if (event.type === 'unregister') {
      unregisterPlatform(event.name);
      return;
    }
    if (event.type === 'replace') unregisterPlatform(event.name);
    const current = registry.get(event.name);
    if (current) registerPlatform(current);
  });

  const registerInRegistry = (tool: RuntimeTool): RuntimeTool => {
    if (destroyed) throw new RuntimeDestroyedError();
    try {
      return registry.register(tool);
    } catch (error) {
      addDiagnostic({ code: 'tool-registration-failed', message: error instanceof Error ? error.message : 'Tool registration failed.', toolName: tool.name });
      throw error;
    }
  };

  const reconcileDiscovery = (): void => {
    if (destroyed || (mode !== 'auto' && mode !== 'hybrid') || !root) return;
    let tools: readonly RuntimeTool[];
    try {
      const compilation = discoverSemanticUI(root, discoveryOptions);
      tools = compilation.tools;
      semanticGraph = compilation.graph;
    } catch {
      addDiagnostic({ code: 'discovery-failed', message: 'UI discovery failed.' });
      return;
    }
    const next = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of discoveredTools.keys()) {
      if (next.has(name)) continue;
      registry.unregister(name);
      discoveredTools.delete(name);
    }
    for (const tool of next.values()) {
      const fingerprint = discoveredToolFingerprint(tool);
      const current = registry.get(tool.name);
      if (!current) {
        try {
          registerInRegistry(tool);
          discoveredTools.set(tool.name, fingerprint);
        } catch { /* diagnosed */ }
      } else if (discoveredTools.has(tool.name) && discoveredTools.get(tool.name) !== fingerprint) {
        try {
          registry.replace(tool);
          discoveredTools.set(tool.name, fingerprint);
        } catch { /* diagnosed */ }
      }
    }
  };

  const rescan = (): void => {
    if (!running || destroyed) return;
    lastInvalidation = Date.now();
    if (rescanScheduled) return;
    rescanScheduled = true;
    queueMicrotask(() => {
      rescanScheduled = false;
      if (!running || destroyed) return;
      rescanRunning = true;
      try {
        reconcileDiscovery();
        syncRevision += 1;
      } finally {
        rescanRunning = false;
        lastInvalidation = Date.now();
      }
    });
  };

  const hasBusyState = (): boolean => {
    if (!root || !synchronization.busySelector) return false;
    try { return root.querySelector(synchronization.busySelector) !== null; } catch { return false; }
  };

  async function waitForIdleInternal(
    waitOptions: RuntimeWaitOptions = {},
  ): Promise<RuntimeSynchronizationResult> {
    if (destroyed) throw new RuntimeDestroyedError();
    const settleMs = Math.max(0, waitOptions.settleMs ?? synchronization.settleMs);
    const timeoutMs = Math.max(0, waitOptions.timeoutMs ?? synchronization.timeoutMs);
    const startedAt = Date.now();
    await Promise.resolve();
    return new Promise((resolve) => {
      const check = (): void => {
        const elapsedMs = Date.now() - startedAt;
        const quietFor = Date.now() - lastInvalidation;
        if (!rescanScheduled && !rescanRunning && quietFor >= settleMs && !hasBusyState()) {
          resolve({ status: 'idle', revision: syncRevision, elapsedMs });
          return;
        }
        if (elapsedMs >= timeoutMs) {
          resolve({ status: 'timeout', revision: syncRevision, elapsedMs });
          return;
        }
        const remaining = timeoutMs - elapsedMs;
        setTimeout(check, Math.min(25, Math.max(1, remaining)));
      };
      check();
    });
  }

  const discover = (): readonly RuntimeTool[] => {
    if (destroyed || (mode !== 'auto' && mode !== 'hybrid') || !root) return Object.freeze([]);
    let tools: readonly RuntimeTool[];
    try {
      const compilation = discoverSemanticUI(root, discoveryOptions);
      tools = compilation.tools;
      semanticGraph = compilation.graph;
    } catch {
      addDiagnostic({ code: 'discovery-failed', message: 'UI discovery failed.' });
      return Object.freeze([]);
    }
    const added: RuntimeTool[] = [];
    for (const tool of tools) {
      if (registry.get(tool.name) || discoveredTools.has(tool.name)) continue;
      try {
        const stored = registerInRegistry(tool);
        discoveredTools.set(stored.name, discoveredToolFingerprint(stored));
        added.push(stored);
      } catch { /* registration diagnostics are already recorded */ }
    }
    return Object.freeze(added);
  };

  const runtime: WebMCPRuntime = {
    mode,
    diagnostics,
    start(): void {
      if (destroyed || running) return;
      running = true;
      for (const tool of registry.list()) registerPlatform(tool);
      if (autoDiscover) discover();
      if (observe && autoDiscover && root) {
        observer ??= new RuntimeObserver(root, rescan, options.observerOptions);
        observer.start();
      }
      invalidationCleanups = [];
      for (const source of options.invalidationSources ?? []) {
        try {
          const cleanup = source.subscribe(rescan);
          if (cleanup) invalidationCleanups.push(cleanup);
        } catch {
          addDiagnostic({
            code: 'invalidation-source-failed',
            message: 'An application invalidation source could not be subscribed.',
          });
        }
      }
    },
    stop(): void {
      if (!running && platformRegistrations.size === 0) return;
      for (const name of [...platformRegistrations.keys()]) unregisterPlatform(name);
      if (!running) return;
      observer?.stop();
      for (const cleanup of invalidationCleanups.splice(0)) {
        try { cleanup(); } catch {
          addDiagnostic({
            code: 'invalidation-source-failed',
            message: 'An application invalidation source could not be unsubscribed.',
          });
        }
      }
      rescanScheduled = false;
      rescanRunning = false;
      // Discovery is a temporary view of the DOM. Explicit, manual and adapter
      // registrations remain available across a stop/start cycle.
      for (const name of discoveredTools.keys()) registry.unregister(name);
      discoveredTools.clear();
      running = false;
    },
    isRunning: (): boolean => running,
    destroy(): void {
      if (destroyed) return;
      runtime.stop();
      registry.clear();
      discoveredTools.clear();
      destroyed = true;
    },
    registerTool(tool: RuntimeTool): RuntimeToolDescriptor {
      return descriptorOf(registerInRegistry(tool));
    },
    unregisterTool(name: string): boolean {
      if (destroyed) throw new RuntimeDestroyedError();
      discoveredTools.delete(name);
      return registry.unregister(name);
    },
    discover: (): readonly RuntimeToolDescriptor[] => Object.freeze(discover().map(descriptorOf)),
    refresh(): readonly RuntimeToolDescriptor[] {
      if (destroyed) throw new RuntimeDestroyedError();
      lastInvalidation = Date.now();
      reconcileDiscovery();
      syncRevision += 1;
      lastInvalidation = Date.now();
      return Object.freeze(registry.list().map(descriptorOf));
    },
    waitForIdle(waitOptions: RuntimeWaitOptions = {}): Promise<RuntimeSynchronizationResult> {
      if (destroyed) throw new RuntimeDestroyedError();
      if (running) rescan();
      else runtime.refresh();
      return waitForIdleInternal(waitOptions);
    },
    async waitForTool(
      name: string,
      waitOptions: RuntimeWaitOptions = {},
    ): Promise<RuntimeToolDescriptor | undefined> {
      if (destroyed) throw new RuntimeDestroyedError();
      const timeoutMs = Math.max(0, waitOptions.timeoutMs ?? synchronization.timeoutMs);
      const startedAt = Date.now();
      do {
        runtime.refresh();
        const current = registry.get(name);
        if (current) return descriptorOf(current);
        const elapsed = Date.now() - startedAt;
        if (elapsed >= timeoutMs) return undefined;
        await new Promise((resolve) => setTimeout(resolve, Math.min(25, timeoutMs - elapsed)));
      } while (!destroyed);
      throw new RuntimeDestroyedError();
    },
    listTools: (): readonly RuntimeToolDescriptor[] => Object.freeze(registry.list().map(descriptorOf)),
    getSemanticGraph: (): SemanticUIGraph | undefined => semanticGraph,
    invokeTool(name: string, input: JsonObject): Promise<JsonValue> {
      if (destroyed) throw new RuntimeDestroyedError();
      const tool = registry.get(name);
      if (!tool) {
        const error = jsonError('tool-not-found', `Tool "${name}" is not registered.`);
        addDiagnostic({ code: 'tool-not-found', message: error.error as string, toolName: name });
        return Promise.resolve(error);
      }
      return invokeThroughPolicy(tool, input);
    },
    getPolicyDecision(tool: RuntimeTool | string): PolicyEvaluation | undefined {
      const value = typeof tool === 'string' ? registry.get(tool) : tool;
      return value ? policyFor(value) : undefined;
    },
  };

  for (const tool of options.initialTools ?? []) registerInRegistry(tool);
  if (options.autoStart === true) runtime.start();
  return runtime;
}
