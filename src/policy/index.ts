import type { RuntimeMode, RuntimeTool, RiskLevel, ProvenanceSource } from '../core/model.js';

export type ConfirmationPolicy = 'risk-based' | 'always' | 'never';
export type PolicyDecision = 'allow' | 'confirm' | 'deny';
export type PolicyOutcome = PolicyDecision;

export type PolicyReasonCode =
  | 'mode-source-mismatch'
  | 'source-not-allowed'
  | 'confidence-below-threshold'
  | 'critical-risk'
  | 'mutating-inferred-tool'
  | 'confirmation-required'
  | 'allowed-read-only'
  | 'allowed-explicit'
  | 'allowed-manual'
  | 'allowed-adapter'
  | 'allowed-inference';

export interface PolicyReason {
  readonly code: PolicyReasonCode;
  readonly message: string;
}

export interface RiskPolicyConfig {
  readonly confirmationPolicy?: ConfirmationPolicy;
  /** Minimum confidence for inferred sources. Defaults to 0.8. */
  readonly minimumConfidence?: number;
  /** Risk levels which require confirmation under risk-based policy. */
  readonly confirmationRiskLevels?: readonly RiskLevel[];
}
export type PolicyConfig = RiskPolicyConfig;

export interface PolicyEvaluation {
  readonly decision: PolicyDecision;
  readonly reasons: readonly PolicyReason[];
  readonly mode: RuntimeMode;
  readonly source: ProvenanceSource;
  readonly confidence: number;
  readonly risk: RiskLevel;
}

const defaultConfirmationRisks: readonly RiskLevel[] = ['medium', 'high'];
const hybridSources: readonly ProvenanceSource[] = ['explicit', 'manual', 'adapter', 'metadata', 'discovery'];
const autoSources: readonly ProvenanceSource[] = ['metadata', 'discovery', 'heuristic'];

function reason(code: PolicyReasonCode, message: string): PolicyReason {
  return { code, message };
}

function isReadOnly(tool: RuntimeTool): boolean {
  return tool.kind === 'query' || tool.kind === 'navigation';
}

function isWeakInferredSource(tool: RuntimeTool, minimumConfidence: number): boolean {
  return (tool.provenance.source === 'discovery' || tool.provenance.source === 'heuristic')
    && tool.provenance.confidence < minimumConfidence;
}

function allowedSources(mode: RuntimeMode): readonly ProvenanceSource[] {
  if (mode === 'explicit') return ['explicit', 'manual'];
  if (mode === 'adapter') return ['adapter'];
  if (mode === 'auto') return autoSources;
  return hybridSources;
}

/** Pure, deterministic authorization policy. It never invokes a tool or touches the platform. */
export function evaluateToolPolicy(
  tool: RuntimeTool,
  mode: RuntimeMode,
  config: RiskPolicyConfig = {},
): PolicyEvaluation {
  const source = tool.provenance.source;
  const confidence = tool.provenance.confidence;
  const minimumConfidence = config.minimumConfidence ?? 0.8;
  const confirmationPolicy = config.confirmationPolicy ?? 'risk-based';
  const confirmationRisks = config.confirmationRiskLevels ?? defaultConfirmationRisks;
  const reasons: PolicyReason[] = [];

  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
    throw new RangeError('minimumConfidence must be a number between 0 and 1.');
  }

  if (!allowedSources(mode).includes(source)) {
    reasons.push(reason(
      mode === 'explicit' || mode === 'adapter' ? 'mode-source-mismatch' : 'source-not-allowed',
      `Source "${source}" is not enabled in ${mode} mode.`,
    ));
    return { decision: 'deny', reasons, mode, source, confidence, risk: tool.risk.level };
  }

  if (tool.risk.level === 'critical') {
    reasons.push(reason('critical-risk', 'Critical-risk tools are never authorized automatically.'));
    return { decision: 'deny', reasons, mode, source, confidence, risk: tool.risk.level };
  }

  if (isWeakInferredSource(tool, minimumConfidence)) {
    reasons.push(reason('confidence-below-threshold', `Confidence ${confidence} is below ${minimumConfidence}.`));
    return { decision: 'deny', reasons, mode, source, confidence, risk: tool.risk.level };
  }

  const inferred = source === 'metadata' || source === 'discovery' || source === 'heuristic';
  const mutatingInferred = inferred && !isReadOnly(tool);
  if (mutatingInferred) {
    reasons.push(reason('mutating-inferred-tool', 'Mutating tools inferred from metadata or heuristics require user confirmation.'));
  }

  const requiresConfirmation = tool.risk.requiresConfirmation === true
    || mutatingInferred
    || confirmationPolicy === 'always'
    || (confirmationPolicy === 'risk-based' && confirmationRisks.includes(tool.risk.level));

  if (requiresConfirmation) {
    reasons.push(reason('confirmation-required', 'The configured risk policy requires user confirmation.'));
    if (confirmationPolicy === 'never') {
      // "never" disables prompts, but inferred mutations still cannot pass without one.
      if (mutatingInferred) {
        return { decision: 'deny', reasons, mode, source, confidence, risk: tool.risk.level };
      }
      return { decision: 'allow', reasons, mode, source, confidence, risk: tool.risk.level };
    }
    return { decision: 'confirm', reasons, mode, source, confidence, risk: tool.risk.level };
  }

  reasons.push(reason(
    source === 'explicit' || source === 'manual' ? (source === 'manual' ? 'allowed-manual' : 'allowed-explicit') : source === 'adapter' ? 'allowed-adapter' : 'allowed-inference',
    isReadOnly(tool) ? 'Read-only tool meets the confidence threshold.' : 'Tool is allowed by the configured policy.',
  ));
  return { decision: 'allow', reasons, mode, source, confidence, risk: tool.risk.level };
}

export class RiskPolicy {
  public constructor(
    public readonly mode: RuntimeMode,
    public readonly config: RiskPolicyConfig = {},
  ) {}

  public evaluate(tool: RuntimeTool): PolicyEvaluation {
    return evaluateToolPolicy(tool, this.mode, this.config);
  }
}

export const evaluateRuntimeTool = evaluateToolPolicy;
