/** JSON-compatible values used by capability contracts. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type RuntimeMode = 'explicit' | 'adapter' | 'auto' | 'hybrid';
export type CapabilityKind = 'query' | 'action' | 'navigation' | 'form';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Confidence = number;
export type ProvenanceSource =
  | 'explicit'
  | 'manual'
  | 'adapter'
  | 'metadata'
  | 'discovery'
  | 'heuristic'
  | 'imported'
  | 'system';
export type LifecycleState = 'registered' | 'active' | 'disabled' | 'removed';
export type CapabilityStatus = 'available' | 'unavailable' | 'deprecated';

export interface CapabilityRisk {
  readonly level: RiskLevel;
  readonly requiresConfirmation?: boolean;
}

export interface CapabilityProvenance {
  readonly source: ProvenanceSource;
  readonly confidence: Confidence;
  readonly sourceId?: string;
}

export interface TargetUI {
  readonly selector?: string;
  readonly role?: string;
  readonly label?: string;
  readonly description?: string;
}

/** WebMCP-standard hints exposed to the browser agent. */
export interface ToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
}

export type RuntimeToolHandler = (
  input: JsonObject,
) => JsonValue | PromiseLike<JsonValue>;

export interface RuntimeTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly kind: CapabilityKind;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly annotations?: ToolAnnotations;
  readonly risk: CapabilityRisk;
  readonly provenance: CapabilityProvenance;
  readonly targetUI?: TargetUI;
  readonly metadata?: JsonObject;
  readonly lifecycle?: LifecycleState;
  readonly status?: CapabilityStatus;
  readonly handler: RuntimeToolHandler;
}

/** Public, non-invocable view of a registered capability. */
export type RuntimeToolDescriptor = Omit<RuntimeTool, 'handler'>;
