import { currentMessageLines } from '../extraction-v2/event-type-extractor.js';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import type {
  EvidenceConflict,
  EvidenceProvenance,
  EvidenceReference,
  ExplicitOrderRelation,
  OrderRelationKind,
} from './types.js';

export const EXPLICIT_ORDER_RELATION_VERSION = 'explicit-order-relation-v2';

interface RelationCandidate {
  relation: OrderRelationKind;
  parentRaw: string;
  childRaw: string;
  source: 'subject' | 'body';
}

interface RelationPattern {
  relation: OrderRelationKind;
  pattern: RegExp;
  parentGroup: number;
  childGroup: number;
}

interface ChildLabelPattern {
  relation: OrderRelationKind;
  pattern: RegExp;
}

export interface ExplicitOrderRelationExtractionResult {
  relation: ExplicitOrderRelation | null;
  conflicts: EvidenceConflict[];
}

const ID = '([A-Z0-9][A-Z0-9\\-_/]{3,39})';
const ORDER_LABEL = '(?:order|rendeles|megrendeles)';
const ORDER_SUFFIX = '(?:\\s*(?:number|no\\.?|id|szama|azonositoja))?';
// Transactional templates commonly render labels as `Order: #1234`.
// Accept at most one label separator plus an optional hash marker.
const MARKER = '\\s*[:#-]?\\s*#?\\s*';

function expression(parts: string, flags = 'gis'): RegExp {
  return new RegExp(parts, flags);
}

const PARENT_LABEL_PATTERNS: RegExp[] = [
  expression(`\\b(?:original|parent)\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b`, 'i'),
  expression(`\\b(?:eredeti|szulo)\\s+${ORDER_LABEL}${ORDER_SUFFIX}${MARKER}${ID}\\b`, 'i'),
];

const CHILD_LABEL_PATTERNS: ChildLabelPattern[] = [
  {
    relation: 'replacement',
    pattern: expression(`\\breplacement\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b`, 'i'),
  },
  {
    relation: 'replacement',
    pattern: expression(`\\b(?:csere\\s*${ORDER_LABEL}|csererendeles)${ORDER_SUFFIX}${MARKER}${ID}\\b`, 'i'),
  },
  {
    relation: 'split_child',
    pattern: expression(`\\bsplit(?:\\s+child)?\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b`, 'i'),
  },
  {
    relation: 'split_child',
    pattern: expression(`\\b(?:resz\\s*${ORDER_LABEL}|reszrendeles)${ORDER_SUFFIX}${MARKER}${ID}\\b`, 'i'),
  },
  {
    relation: 'child',
    pattern: expression(`\\bchild\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b`, 'i'),
  },
];

const RELATION_PATTERNS: RelationPattern[] = [
  {
    relation: 'replacement',
    pattern: expression(`\\breplacement\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\b(?:for|replaces)\\s+(?:the\\s+)?(?:original\\s+)?order${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    childGroup: 1,
    parentGroup: 2,
  },
  {
    relation: 'replacement',
    pattern: expression(`\\b(?:original|parent)\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\breplacement\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    parentGroup: 1,
    childGroup: 2,
  },
  {
    relation: 'split_child',
    pattern: expression(`\\bsplit(?:\\s+child)?\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\b(?:from|of|for)\\s+(?:the\\s+)?(?:original|parent)?\\s*order${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    childGroup: 1,
    parentGroup: 2,
  },
  {
    relation: 'child',
    pattern: expression(`\\bchild\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\b(?:from|of|for)\\s+(?:the\\s+)?parent\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    childGroup: 1,
    parentGroup: 2,
  },
  {
    relation: 'child',
    pattern: expression(`\\bparent\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\bchild\\s+order${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    parentGroup: 1,
    childGroup: 2,
  },
  {
    relation: 'replacement',
    pattern: expression(`\\b(?:eredeti|szulo)\\s+${ORDER_LABEL}${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\b(?:csere\\s*${ORDER_LABEL}|csererendeles)${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    parentGroup: 1,
    childGroup: 2,
  },
  {
    relation: 'replacement',
    pattern: expression(`\\b(?:csere\\s*${ORDER_LABEL}|csererendeles)${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\b(?:az?\\s+)?(?:eredeti|szulo)\\s+${ORDER_LABEL}${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    childGroup: 1,
    parentGroup: 2,
  },
  {
    relation: 'split_child',
    pattern: expression(`\\b(?:eredeti|szulo)\\s+${ORDER_LABEL}${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\b(?:resz\\s*${ORDER_LABEL}|reszrendeles)${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    parentGroup: 1,
    childGroup: 2,
  },
  {
    relation: 'split_child',
    pattern: expression(`\\b(?:resz\\s*${ORDER_LABEL}|reszrendeles)${ORDER_SUFFIX}${MARKER}${ID}\\b.{0,180}\\b(?:az?\\s+)?(?:eredeti|szulo)?\\s*${ORDER_LABEL}${ORDER_SUFFIX}${MARKER}${ID}\\b`),
    childGroup: 1,
    parentGroup: 2,
  },
  {
    relation: 'split_child',
    pattern: expression(`\\b${ID}\\s+szamu\\s+(?:resz\\s*${ORDER_LABEL}|reszrendeles)\\b.{0,180}\\b${ID}\\s+szamu\\s+(?:eredeti\\s+)?${ORDER_LABEL}\\b`),
    childGroup: 1,
    parentGroup: 2,
  },
  {
    relation: 'replacement',
    pattern: expression(`\\b${ID}\\s+szamu\\s+(?:csere\\s*${ORDER_LABEL}|csererendeles)\\b.{0,180}\\b${ID}\\s+szamu\\s+(?:eredeti\\s+)?${ORDER_LABEL}\\b`),
    childGroup: 1,
    parentGroup: 2,
  },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function cleanIdentifier(value: string): string {
  return value.trim().replace(/^#+/, '').replace(/[.,;:)}\]]+$/, '');
}

function firstParentLabel(line: string): string | null {
  for (const pattern of PARENT_LABEL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (!match) continue;
    const raw = cleanIdentifier(match[1] ?? '');
    if (normalizeStableIdentifier(raw)) return raw;
  }
  return null;
}

function firstChildLabel(line: string): { relation: OrderRelationKind; raw: string } | null {
  for (const definition of CHILD_LABEL_PATTERNS) {
    definition.pattern.lastIndex = 0;
    const match = definition.pattern.exec(line);
    if (!match) continue;
    const raw = cleanIdentifier(match[1] ?? '');
    if (normalizeStableIdentifier(raw)) return { relation: definition.relation, raw };
  }
  return null;
}

/**
 * Explicit parent/child labels often arrive on adjacent lines and either label
 * may come first. Pair only strongly labelled values within a narrow two-line
 * window. A child already paired with a preceding parent is not carried forward
 * as a pending child, which avoids cross-pairing neighboring independent orders.
 */
function collectLabelledLinePairs(
  normalizedText: string,
  source: RelationCandidate['source'],
): RelationCandidate[] {
  const candidates: RelationCandidate[] = [];
  const lines = normalizedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let pendingParent: { raw: string; lineIndex: number } | null = null;
  let pendingChild: { relation: OrderRelationKind; raw: string; lineIndex: number } | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const parentRaw = firstParentLabel(line);
    const child = firstChildLabel(line);

    if (pendingParent && lineIndex - pendingParent.lineIndex > 2) pendingParent = null;
    if (pendingChild && lineIndex - pendingChild.lineIndex > 2) pendingChild = null;

    if (parentRaw && child) {
      candidates.push({
        relation: child.relation,
        parentRaw,
        childRaw: child.raw,
        source,
      });
      pendingParent = { raw: parentRaw, lineIndex };
      pendingChild = null;
      continue;
    }

    if (parentRaw) {
      if (pendingChild) {
        candidates.push({
          relation: pendingChild.relation,
          parentRaw,
          childRaw: pendingChild.raw,
          source,
        });
        pendingChild = null;
      }
      pendingParent = { raw: parentRaw, lineIndex };
      continue;
    }

    if (child) {
      if (pendingParent) {
        candidates.push({
          relation: child.relation,
          parentRaw: pendingParent.raw,
          childRaw: child.raw,
          source,
        });
      } else {
        pendingChild = { relation: child.relation, raw: child.raw, lineIndex };
      }
    }
  }

  return candidates;
}

function collectFromText(text: string, source: RelationCandidate['source']): RelationCandidate[] {
  const normalized = normalizeText(text);
  const candidates: RelationCandidate[] = [
    ...collectLabelledLinePairs(normalized, source),
  ];

  for (const definition of RELATION_PATTERNS) {
    definition.pattern.lastIndex = 0;
    for (const match of normalized.matchAll(definition.pattern)) {
      const parentRaw = cleanIdentifier(match[definition.parentGroup] ?? '');
      const childRaw = cleanIdentifier(match[definition.childGroup] ?? '');
      if (!normalizeStableIdentifier(parentRaw) || !normalizeStableIdentifier(childRaw)) continue;
      candidates.push({
        relation: definition.relation,
        parentRaw,
        childRaw,
        source,
      });
    }
  }

  return candidates;
}

function provenance(source: RelationCandidate['source']): EvidenceProvenance {
  return {
    field: 'order_relation',
    source,
    parserVersion: null,
    extractorId: 'explicit-order-relation',
    extractorVersion: EXPLICIT_ORDER_RELATION_VERSION,
    confidence: 0.995,
    qualifiers: ['explicit_parent_child_order'],
  };
}

function evidenceReference(candidate: RelationCandidate): EvidenceReference {
  return {
    field: 'order_relation',
    value: {
      relation: candidate.relation,
      parentOrderId: candidate.parentRaw,
      childOrderId: candidate.childRaw,
    },
    source: candidate.source,
    confidence: 0.995,
    extractorId: 'explicit-order-relation',
    extractorVersion: EXPLICIT_ORDER_RELATION_VERSION,
    qualifiers: ['explicit_parent_child_order'],
  };
}

export function extractExplicitOrderRelation(
  document: EmailDocumentV1,
  currentOrderId: string | null | undefined,
): ExplicitOrderRelationExtractionResult {
  const currentOrderNormalized = normalizeStableIdentifier(currentOrderId);
  if (!currentOrderNormalized) return { relation: null, conflicts: [] };

  const body = currentMessageLines(document.text).join('\n');
  const allCandidates = [
    ...collectFromText(document.subject ?? '', 'subject'),
    ...collectFromText(body, 'body'),
  ].filter((candidate) => {
    const parent = normalizeStableIdentifier(candidate.parentRaw);
    const child = normalizeStableIdentifier(candidate.childRaw);
    return Boolean(parent && child && parent !== child && child === currentOrderNormalized);
  });

  const unique = new Map<string, RelationCandidate[]>();
  for (const candidate of allCandidates) {
    const parent = normalizeStableIdentifier(candidate.parentRaw)!;
    const child = normalizeStableIdentifier(candidate.childRaw)!;
    const key = `${candidate.relation}:${parent}:${child}`;
    const group = unique.get(key) ?? [];
    group.push(candidate);
    unique.set(key, group);
  }

  if (unique.size === 0) return { relation: null, conflicts: [] };

  if (unique.size > 1) {
    const conflicting = [...unique.values()].flat();
    const evidence = conflicting.map(evidenceReference);
    return {
      relation: null,
      conflicts: [{
        field: 'order_relation',
        values: evidence.map((item) => item.value),
        evidence,
        severity: 'hard',
        explanation: 'Multiple explicit parent/child order relations conflict for the current order.',
      }],
    };
  }

  const group = [...unique.values()][0]!;
  const first = group[0]!;
  const relationProvenance = [...new Map(
    group.map((candidate) => [candidate.source, provenance(candidate.source)]),
  ).values()];

  return {
    relation: {
      relation: first.relation,
      parentOrderIdRaw: first.parentRaw,
      parentOrderIdNormalized: normalizeStableIdentifier(first.parentRaw),
      childOrderIdRaw: first.childRaw,
      childOrderIdNormalized: normalizeStableIdentifier(first.childRaw),
      provenance: relationProvenance,
    },
    conflicts: [],
  };
}
