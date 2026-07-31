import {
  CapabilityValidationError,
  DuplicateCapabilityError,
  MissingCapabilityError,
} from './errors.js';
import type {
  CapabilityProvenance,
  CapabilityRisk,
  JsonObject,
  JsonValue,
  RuntimeTool,
  TargetUI,
  ToolAnnotations,
} from './model.js';

export type RegistryChangeType = 'register' | 'replace' | 'unregister' | 'clear';

export interface RegistryChangeEvent {
  readonly type: RegistryChangeType;
  readonly name?: string;
  readonly version: number;
}

export type RegistryListener = (event: RegistryChangeEvent) => void;

const namePattern = /^[A-Za-z0-9._-]{1,128}$/;

function isJsonObject(value: JsonValue | object): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isJsonObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) value.forEach(freezeJson);
  else if (isJsonObject(value)) Object.values(value).forEach(freezeJson);
  Object.freeze(value);
  return value;
}

function validateTool(tool: RuntimeTool): void {
  if (!tool.name.trim() || !namePattern.test(tool.name)) {
    throw new CapabilityValidationError(
      'Capability name must be 1-128 ASCII letters, digits, ., _, or -.',
    );
  }
  if (tool.title !== undefined && typeof tool.title !== 'string') {
    throw new CapabilityValidationError('Capability title must be a string when provided.');
  }
  if (!tool.description.trim()) throw new CapabilityValidationError('Capability description cannot be empty.');
  if (!isJsonObject(tool.inputSchema)) throw new CapabilityValidationError('Capability inputSchema must be an object.');
  if (tool.outputSchema !== undefined && !isJsonObject(tool.outputSchema)) {
    throw new CapabilityValidationError('Capability outputSchema must be an object when provided.');
  }
  if (!Number.isFinite(tool.provenance.confidence) || tool.provenance.confidence < 0 || tool.provenance.confidence > 1) {
    throw new CapabilityValidationError('Capability confidence must be a number between 0 and 1.');
  }
  if (tool.annotations !== undefined) {
    if (!isJsonObject(tool.annotations)) {
      throw new CapabilityValidationError('Capability annotations must be an object when provided.');
    }
    if (tool.annotations.readOnlyHint !== undefined && typeof tool.annotations.readOnlyHint !== 'boolean') {
      throw new CapabilityValidationError('Capability readOnlyHint must be a boolean when provided.');
    }
    if (tool.annotations.untrustedContentHint !== undefined && typeof tool.annotations.untrustedContentHint !== 'boolean') {
      throw new CapabilityValidationError('Capability untrustedContentHint must be a boolean when provided.');
    }
  }
}

function copyTool(tool: RuntimeTool): RuntimeTool {
  const copy: RuntimeTool = {
    ...tool,
    inputSchema: cloneJson(tool.inputSchema) as JsonObject,
    outputSchema: tool.outputSchema === undefined ? undefined : cloneJson(tool.outputSchema) as JsonObject,
    risk: { ...tool.risk } as CapabilityRisk,
    provenance: { ...tool.provenance } as CapabilityProvenance,
    targetUI: tool.targetUI === undefined ? undefined : { ...tool.targetUI } as TargetUI,
    annotations: tool.annotations === undefined ? undefined : {
      ...(tool.annotations.readOnlyHint === undefined ? {} : { readOnlyHint: tool.annotations.readOnlyHint }),
      ...(tool.annotations.untrustedContentHint === undefined
        ? {}
        : { untrustedContentHint: tool.annotations.untrustedContentHint }),
    } as ToolAnnotations,
    metadata: tool.metadata === undefined ? undefined : cloneJson(tool.metadata) as JsonObject,
  };
  freezeJson(copy.inputSchema);
  if (copy.outputSchema !== undefined) freezeJson(copy.outputSchema);
  Object.freeze(copy.risk);
  Object.freeze(copy.provenance);
  if (copy.targetUI !== undefined) Object.freeze(copy.targetUI);
  if (copy.annotations !== undefined) Object.freeze(copy.annotations);
  if (copy.metadata !== undefined) freezeJson(copy.metadata);
  return Object.freeze(copy);
}

export class CapabilityRegistry {
  private readonly tools = new Map<string, RuntimeTool>();
  private readonly listeners = new Set<RegistryListener>();
  private version = 0;

  public register(tool: RuntimeTool): RuntimeTool {
    validateTool(tool);
    if (this.tools.has(tool.name)) throw new DuplicateCapabilityError(tool.name);
    const stored = copyTool(tool);
    this.tools.set(stored.name, stored);
    this.emit({ type: 'register', name: stored.name, version: ++this.version });
    return stored;
  }

  public unregister(name: string): boolean {
    if (!this.tools.delete(name)) return false;
    this.emit({ type: 'unregister', name, version: ++this.version });
    return true;
  }

  public replace(tool: RuntimeTool): RuntimeTool {
    validateTool(tool);
    if (!this.tools.has(tool.name)) throw new MissingCapabilityError(tool.name);
    const stored = copyTool(tool);
    this.tools.set(stored.name, stored);
    this.emit({ type: 'replace', name: stored.name, version: ++this.version });
    return stored;
  }

  public upsert(tool: RuntimeTool): RuntimeTool {
    return this.tools.has(tool.name) ? this.replace(tool) : this.register(tool);
  }

  public get(name: string): RuntimeTool | undefined {
    return this.tools.get(name);
  }

  public list(): readonly RuntimeTool[] {
    return this.snapshot();
  }

  public clear(): void {
    if (this.tools.size === 0) return;
    this.tools.clear();
    this.emit({ type: 'clear', version: ++this.version });
  }

  public snapshot(): readonly RuntimeTool[] {
    return Object.freeze(Array.from(this.tools.values()));
  }

  public subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RegistryChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export { CapabilityValidationError, DuplicateCapabilityError, MissingCapabilityError, RuntimeDestroyedError } from './errors.js';
