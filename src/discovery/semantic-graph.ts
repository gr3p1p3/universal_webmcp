import type { CapabilityKind, RuntimeTool } from '../core/model.js';
import type { DomAction } from '../dom/actions.js';
import { isEffectivelyDisabled } from '../dom/state.js';

export type SemanticRule =
  | 'explicit-metadata'
  | 'semantic-form'
  | 'repeated-structure'
  | 'aria-html'
  | 'textual-heuristic';

export type SemanticEdgeRelation = 'owns' | 'dominates' | 'equivalent';
export type SemanticExclusionReason =
  | 'dominated'
  | 'equivalent'
  | 'below-confidence'
  | 'catalog-budget';

export interface SemanticCatalogOptions {
  /** Maximum automatic tools. Explicit metadata is never removed. Defaults to 64. */
  readonly maxTools?: number;
  /** Minimum discovery confidence admitted to the catalog. Defaults to 0.8. */
  readonly minimumConfidence?: number;
  /** Collapse controls already represented by a task-level capability. Defaults to true. */
  readonly dominance?: boolean;
}

export interface SemanticUINode {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly kind: CapabilityKind;
  readonly action?: DomAction;
  readonly pattern: string;
  readonly rule: SemanticRule;
  readonly priority: number;
  readonly confidence: number;
  readonly selected: boolean;
  readonly exclusionReason?: SemanticExclusionReason;
}

export interface SemanticUIEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: SemanticEdgeRelation;
}

export interface SemanticUIGraph {
  readonly nodes: readonly SemanticUINode[];
  readonly edges: readonly SemanticUIEdge[];
  readonly selectedToolNames: readonly string[];
}

export interface SemanticCandidate {
  readonly id: string;
  readonly capabilityKey: string;
  readonly tool: RuntimeTool;
  readonly element: Element;
  readonly action?: DomAction;
  readonly pattern: string;
  readonly rule: SemanticRule;
  readonly priority: number;
  readonly explicit: boolean;
}

export interface SemanticCompilation {
  readonly tools: readonly RuntimeTool[];
  readonly graph: SemanticUIGraph;
}

function validateOptions(options: SemanticCatalogOptions): Required<SemanticCatalogOptions> {
  const maxTools = options.maxTools ?? 64;
  const minimumConfidence = options.minimumConfidence ?? 0.8;
  if (!Number.isInteger(maxTools) || maxTools < 1) {
    throw new RangeError('catalog.maxTools must be a positive integer.');
  }
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
    throw new RangeError('catalog.minimumConfidence must be between 0 and 1.');
  }
  return { maxTools, minimumConfidence, dominance: options.dominance !== false };
}

function rank(left: SemanticCandidate, right: SemanticCandidate): number {
  return right.priority - left.priority
    || right.tool.provenance.confidence - left.tool.provenance.confidence
    || left.id.localeCompare(right.id)
    || left.tool.name.localeCompare(right.tool.name);
}

function ownerForm(candidate: SemanticCandidate): HTMLFormElement | null {
  if (candidate.element.tagName.toLowerCase() === 'form') return candidate.element as HTMLFormElement;
  if ('form' in candidate.element) {
    const form = (candidate.element as Element & { readonly form?: HTMLFormElement | null }).form;
    if (form) return form;
  }
  return candidate.element.closest('form');
}

function isFormMemberDominated(
  owner: SemanticCandidate,
  member: SemanticCandidate,
): boolean {
  if (owner === member || member.explicit || owner.tool.kind !== 'form') return false;
  if (owner.element.tagName.toLowerCase() !== 'form') return false;
  if (owner.action !== 'submit') return false;
  if (isEffectivelyDisabled(owner.element)) return false;
  const form = ownerForm(owner);
  if (!form || ownerForm(member) !== form) return false;
  const formSubmitters = Array.from(form.elements)
    .filter((control): control is Element & { form?: HTMLFormElement | null; type?: string } => (
      typeof (control as Element).getAttribute === 'function'
    ))
    .filter((control) => {
      const tag = control.tagName.toLowerCase();
      const type = (control.type || '').toLowerCase();
      return control.form === form
        && !isEffectivelyDisabled(control)
        && ((tag === 'button' && !['button', 'reset'].includes(type))
          || (tag === 'input' && ['submit', 'image'].includes(type)));
    });
  const root = form.getRootNode() as ParentNode;
  const imageSubmitters = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="image"]'),
  ).filter((control) => control.form === form && !isEffectivelyDisabled(control));
  const submitters = [...new Set([...formSubmitters, ...imageSubmitters])];
  const tag = member.element.tagName.toLowerCase();
  const type = (member.element.getAttribute('type') || 'text').toLowerCase();
  const fieldName = member.element.getAttribute('name') || '';
  const sameNamedControls = fieldName
    ? Array.from(form.elements).filter((control) => (
      typeof (control as Element).getAttribute === 'function'
      && (control as Element).getAttribute('name') === fieldName
    )).length
    : 0;
  const representedTextControl = member.action === 'fill'
    && submitters.length <= 1
    && !!fieldName
    && sameNamedControls === 1
    && (tag === 'textarea' || (tag === 'input' && ![
      'button', 'submit', 'reset', 'image', 'hidden', 'password', 'file', 'checkbox', 'radio',
    ].includes(type)));
  return representedTextControl;
}

/**
 * Compile raw DOM capabilities into a small deterministic WebMCP catalog.
 * The function is pure with respect to the DOM: it only compares captured
 * elements and never invokes, mutates, or queries application state.
 */
export function compileSemanticCandidates(
  candidates: readonly SemanticCandidate[],
  options: SemanticCatalogOptions = {},
): SemanticCompilation {
  const config = validateOptions(options);
  const exclusions = new Map<string, SemanticExclusionReason>();
  const edges: SemanticUIEdge[] = [];
  const ranked = [...candidates].sort(rank);

  if (config.dominance) {
    const owners = ranked.filter((candidate) => candidate.tool.kind === 'form');
    for (const owner of owners) {
      for (const member of candidates) {
        if (!isFormMemberDominated(owner, member)) continue;
        exclusions.set(member.id, 'dominated');
        edges.push({ from: owner.id, to: member.id, relation: 'dominates' });
        edges.push({ from: owner.id, to: member.id, relation: 'owns' });
      }
    }
  }

  const representatives = new Map<string, SemanticCandidate>();
  for (const candidate of ranked) {
    if (exclusions.has(candidate.id)) continue;
    const representative = representatives.get(candidate.capabilityKey);
    if (!representative) {
      representatives.set(candidate.capabilityKey, candidate);
      continue;
    }
    const declaredEquivalent = candidate.capabilityKey.startsWith('equivalent|');
    if (declaredEquivalent || !candidate.explicit) {
      exclusions.set(candidate.id, 'equivalent');
      edges.push({ from: representative.id, to: candidate.id, relation: 'equivalent' });
      continue;
    }
    representatives.set(candidate.capabilityKey, candidate);
  }

  for (const candidate of candidates) {
    if (candidate.explicit || exclusions.has(candidate.id)) continue;
    if (candidate.tool.provenance.confidence < config.minimumConfidence) {
      exclusions.set(candidate.id, 'below-confidence');
    }
  }

  const automatic = ranked.filter((candidate) => !candidate.explicit && !exclusions.has(candidate.id));
  for (const candidate of automatic.slice(config.maxTools)) {
    exclusions.set(candidate.id, 'catalog-budget');
  }

  const selectedIds = new Set(
    candidates
      .filter((candidate) => !exclusions.has(candidate.id))
      .map((candidate) => candidate.id),
  );
  const tools = candidates
    .filter((candidate) => selectedIds.has(candidate.id))
    .map((candidate) => candidate.tool);
  const nodes = candidates.map((candidate): SemanticUINode => {
    const exclusionReason = exclusions.get(candidate.id);
    return Object.freeze({
      id: candidate.id,
      name: candidate.tool.name,
      label: candidate.tool.targetUI?.label,
      kind: candidate.tool.kind,
      action: candidate.action,
      pattern: candidate.pattern,
      rule: candidate.rule,
      priority: candidate.priority,
      confidence: candidate.tool.provenance.confidence,
      selected: !exclusionReason,
      ...(exclusionReason ? { exclusionReason } : {}),
    });
  });

  return {
    tools: Object.freeze(tools),
    graph: Object.freeze({
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges.map((edge) => Object.freeze(edge))),
      selectedToolNames: Object.freeze(tools.map((tool) => tool.name)),
    }),
  };
}
