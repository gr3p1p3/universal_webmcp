import { executeDomAction, type DomAction } from '../dom/actions.js';
import type {
  CapabilityKind,
  CapabilityRisk,
  JsonObject,
  JsonValue,
  RiskLevel,
  RuntimeTool,
} from '../core/model.js';

const namePattern = /^[A-Za-z][A-Za-z0-9._-]*$/;
const actions: readonly DomAction[] = ['fill', 'submit', 'click', 'select', 'toggle'];

/** Declarative, application-owned mapping from a stable tool name to a UI selector. */
export interface ManualMappingOptions {
  readonly root?: ParentNode;
  readonly description?: string;
  readonly kind?: CapabilityKind;
  readonly risk?: CapabilityRisk;
  readonly inputSchema?: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly metadata?: JsonObject;
  /** Explicitly allow password controls when this mapping fills/submits a form. */
  readonly allowSensitiveFormFields?: boolean;
}

export interface ManualMapping extends ManualMappingOptions {
  readonly name: string;
  readonly selector: string;
  readonly action: DomAction;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateJsonObject(value: JsonObject | undefined, field: string): void {
  if (value !== undefined && !isJsonObject(value)) {
    throw new TypeError(`Manual mapping ${field} must be a JSON object.`);
  }
}

function validateMapping(mapping: ManualMapping): void {
  if (typeof mapping.name !== 'string' || !mapping.name.trim() || !namePattern.test(mapping.name)) {
    throw new TypeError('Manual mapping name must be a non-empty stable identifier (letters, digits, ., _, -).');
  }
  if (typeof mapping.selector !== 'string' || !mapping.selector.trim() || mapping.selector.includes('\0')) {
    throw new TypeError('Manual mapping selector must be a non-empty CSS selector.');
  }
  if (!actions.includes(mapping.action)) {
    throw new TypeError(`Manual mapping action must be one of: ${actions.join(', ')}.`);
  }
  if (mapping.description !== undefined && (!mapping.description.trim())) {
    throw new TypeError('Manual mapping description cannot be empty.');
  }
  validateJsonObject(mapping.inputSchema, 'inputSchema');
  validateJsonObject(mapping.outputSchema, 'outputSchema');
  validateJsonObject(mapping.metadata, 'metadata');
  if (mapping.risk !== undefined && !['low', 'medium', 'high', 'critical'].includes(mapping.risk.level)) {
    throw new TypeError('Manual mapping risk.level must be low, medium, high, or critical.');
  }
  if (mapping.root !== undefined && (typeof mapping.root !== 'object' || typeof mapping.root.querySelector !== 'function')) {
    throw new TypeError('Manual mapping root must be a ParentNode.');
  }
  try {
    // This checks selector syntax when a DOM is available, without requiring the
    // target to exist yet. The action still resolves the target at call time.
    const root = mapping.root ?? getDefaultRoot();
    root?.querySelector(mapping.selector);
  } catch {
    throw new TypeError(`Manual mapping selector is not a valid CSS selector: ${mapping.selector}`);
  }
}

function getDefaultRoot(): ParentNode | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  const candidate = (globalThis as { document?: unknown }).document;
  return candidate && typeof candidate === 'object' && typeof (candidate as ParentNode).querySelector === 'function'
    ? candidate as ParentNode
    : undefined;
}

function jsonResult(result: JsonValue): JsonValue {
  try {
    JSON.stringify(result);
    return result;
  } catch {
    return { status: 'error', error: 'non-serializable-result' };
  }
}

/** Build a RuntimeTool whose DOM target is resolved afresh for every invocation. */
export function createManualMappingTool(mapping: ManualMapping): RuntimeTool {
  validateMapping(mapping);
  const description = mapping.description ?? mapping.name;
  const risk: CapabilityRisk = mapping.risk ?? { level: 'medium' as RiskLevel };

  return {
    name: mapping.name,
    description,
    kind: mapping.kind ?? 'action',
    inputSchema: mapping.inputSchema ?? { type: 'object' },
    outputSchema: mapping.outputSchema ?? { type: 'object' },
    risk,
    provenance: { source: 'manual', confidence: 1, sourceId: mapping.name },
    targetUI: { selector: mapping.selector, description },
    metadata: mapping.metadata,
    handler: (input): JsonValue => {
      const root = mapping.root ?? getDefaultRoot();
      if (!root) return { status: 'error', action: mapping.action, selector: mapping.selector, error: 'root-not-found' };
      return jsonResult(executeDomAction(root, mapping.selector, mapping.action, input, {
        allowSensitiveFormFields: mapping.allowSensitiveFormFields,
      }));
    },
  };
}
