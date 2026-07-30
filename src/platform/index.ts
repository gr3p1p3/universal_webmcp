import type { JsonObject, JsonValue, RuntimeTool } from '../core/model.js';

export interface ToolRegistration {
  readonly name: string;
  readonly registrationId?: string;
}

/** JSON-compatible payload; the standard does not yet fix a request schema. */
export type UserInteractionRequest = JsonObject;

/** JSON-compatible payload; adapters may expose a boolean `confirmed` field. */
export type UserInteractionResult = JsonObject;

export interface ModelContextAdapter {
  isAvailable(): boolean;
  registerTool(tool: RuntimeTool): ToolRegistration;
  unregisterTool(name: string): void;
  requestUserInteraction?(request: UserInteractionRequest): Promise<UserInteractionResult>;
}

interface ModelContextBridge {
  registerTool(tool: RuntimeTool): unknown;
  unregisterTool(name: string): unknown;
  requestUserInteraction?(request: UserInteractionRequest): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBridge(value: unknown): value is ModelContextBridge {
  return isRecord(value)
    && typeof value.registerTool === 'function'
    && typeof value.unregisterTool === 'function';
}

/** The sole browser-global lookup for a model context. */
export function getModelContext(): ModelContextBridge | null {
  if (typeof globalThis === 'undefined') return null;
  const browserDocument = 'document' in globalThis ? (globalThis as { document?: unknown }).document : undefined;
  if (isRecord(browserDocument) && isBridge(browserDocument.modelContext)) return browserDocument.modelContext;
  const browserNavigator = 'navigator' in globalThis ? (globalThis as { navigator?: unknown }).navigator : undefined;
  if (isRecord(browserNavigator) && isBridge(browserNavigator.modelContext)) return browserNavigator.modelContext;
  return null;
}

function registrationHandle(name: string, value: unknown): ToolRegistration {
  if (typeof value === 'string') return { name, registrationId: value };
  if (isRecord(value) && typeof value.registrationId === 'string') {
    return { name, registrationId: value.registrationId };
  }
  return { name };
}

/** Structural adapter: only verified bridge methods are called. */
export class BrowserModelContextAdapter implements ModelContextAdapter {
  public constructor(private readonly context: unknown = getModelContext()) {}

  public isAvailable(): boolean { return isBridge(this.context); }

  public registerTool(tool: RuntimeTool): ToolRegistration {
    if (!isBridge(this.context)) throw new Error('Model context is unavailable.');
    return registrationHandle(tool.name, this.context.registerTool(tool));
  }

  public unregisterTool(name: string): void {
    if (isBridge(this.context)) this.context.unregisterTool(name);
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
    const handle = { name: tool.name, registrationId: `mock:${tool.name}` };
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
