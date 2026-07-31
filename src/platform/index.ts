import type { JsonObject, JsonValue, RuntimeTool } from '../core/model.js';

export interface ToolRegistration {
  readonly name: string;
  /** Resolves when an asynchronous platform registration becomes active. */
  readonly ready?: PromiseLike<void>;
}

export interface BrowserModelContextAdapterOptions {
  /** Secure origins allowed to discover and invoke registered tools. */
  readonly exposedTo?: readonly string[];
}

/** JSON-compatible payload; the standard does not yet fix a request schema. */
export type UserInteractionRequest = JsonObject;

/** JSON-compatible payload; adapters may expose a boolean `confirmed` field. */
export type UserInteractionResult = JsonObject;

export interface ModelContextAdapter {
  isAvailable(): boolean;
  /**
   * Must synchronously establish a registration that unregisterTool() can
   * cancel, even while the optional ready promise is still pending.
   */
  registerTool(tool: RuntimeTool): ToolRegistration;
  /** Cancels both pending and active registrations for this name. */
  unregisterTool(name: string): void;
  requestUserInteraction?(request: UserInteractionRequest): Promise<UserInteractionResult>;
}

interface NativeModelContextTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly execute: (input: object) => Promise<JsonValue>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: boolean;
  };
}

interface ModelContextBridge {
  registerTool(
    tool: NativeModelContextTool,
    options?: { readonly signal?: AbortSignal; readonly exposedTo?: readonly string[] },
  ): PromiseLike<unknown> | unknown;
  requestUserInteraction?(request: UserInteractionRequest): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBridge(value: unknown): value is ModelContextBridge {
  return isRecord(value)
    && typeof value.registerTool === 'function';
}

/** The sole browser-global lookup for a model context. */
export function getModelContext(): ModelContextBridge | null {
  if (typeof globalThis === 'undefined') return null;
  const browserDocument = 'document' in globalThis ? (globalThis as { document?: unknown }).document : undefined;
  if (isRecord(browserDocument) && isBridge(browserDocument.modelContext)) return browserDocument.modelContext;
  return null;
}

function isUntrustedOutput(tool: RuntimeTool): boolean {
  return tool.provenance.source === 'discovery'
    || tool.provenance.source === 'heuristic'
    || tool.provenance.source === 'imported';
}

function nativeTool(tool: RuntimeTool): NativeModelContextTool {
  const title = tool.title ?? tool.targetUI?.label;
  return {
    name: tool.name,
    ...(title ? { title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: async (input): Promise<JsonValue> => {
      if (!isRecord(input) || Array.isArray(input)) {
        throw new TypeError('WebMCP tool input must be an object.');
      }
      return tool.handler(input as JsonObject);
    },
    annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint ?? tool.kind === 'query',
      untrustedContentHint: tool.annotations?.untrustedContentHint ?? isUntrustedOutput(tool),
    },
  };
}

/** Structural adapter: only verified bridge methods are called. */
export class BrowserModelContextAdapter implements ModelContextAdapter {
  private readonly controllers = new Map<string, AbortController>();

  public constructor(
    private readonly context: unknown = getModelContext(),
    private readonly options: BrowserModelContextAdapterOptions = {},
  ) {}

  public isAvailable(): boolean { return isBridge(this.context); }

  public registerTool(tool: RuntimeTool): ToolRegistration {
    if (!isBridge(this.context)) throw new Error('Model context is unavailable.');
    this.unregisterTool(tool.name);
    const controller = new AbortController();
    this.controllers.set(tool.name, controller);
    const ready = Promise.resolve(
      this.context.registerTool(nativeTool(tool), {
        signal: controller.signal,
        ...(this.options.exposedTo === undefined ? {} : { exposedTo: [...this.options.exposedTo] }),
      }),
    ).then(() => undefined).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (this.controllers.get(tool.name) === controller) this.controllers.delete(tool.name);
      throw error;
    });
    return { name: tool.name, ready };
  }

  public unregisterTool(name: string): void {
    const controller = this.controllers.get(name);
    if (!controller) return;
    this.controllers.delete(name);
    controller.abort();
  }

  public async requestUserInteraction(request: UserInteractionRequest): Promise<UserInteractionResult> {
    if (!isBridge(this.context) || typeof this.context.requestUserInteraction !== 'function') {
      throw new Error('Model context does not support user interaction.');
    }
    const result: unknown = await this.context.requestUserInteraction(request);
    return isRecord(result) ? result as UserInteractionResult : { result: result as JsonValue };
  }
}

export class MockModelContextAdapter implements ModelContextAdapter {
  private readonly registrations = new Map<string, ToolRegistration>();
  public readonly interactions: UserInteractionRequest[] = [];
  public interactionResult: UserInteractionResult = { confirmed: true };

  public isAvailable(): boolean { return true; }

  public registerTool(tool: RuntimeTool): ToolRegistration {
    const handle = { name: tool.name };
    this.registrations.set(tool.name, handle);
    return handle;
  }

  public unregisterTool(name: string): void { this.registrations.delete(name); }

  public async requestUserInteraction(request: UserInteractionRequest): Promise<UserInteractionResult> {
    this.interactions.push(request);
    return this.interactionResult;
  }

  public registeredTools(): readonly ToolRegistration[] { return [...this.registrations.values()]; }
}
