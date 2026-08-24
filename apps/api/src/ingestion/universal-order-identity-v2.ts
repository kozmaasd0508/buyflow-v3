export const UNIVERSAL_ORDER_IDENTITY_V2_VERSION = 'universal-order-identity-v2';

export interface UniversalOrderIdentityMatchV2 {
  value: string;
  qualifier: string;
  confidence: number;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒–—]/g, '-');
}

export function normalizeUniversalOrderIdentifierV2(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^#+/, '')
    .replace(/[.,;:!?)]*$/, '');

  if (cleaned.length < 4 || cleaned.length > 40) return null;
  if (!/\d/.test(cleaned)) return null;
  if (/https?:\/\/|www\./i.test(cleaned)) return null;
  if (/[a-z0-9-]+\.[a-z]{2,}(?:\/|$)/i.test(cleaned)) return null;
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(cleaned)) return null;
  return cleaned;
}

function isStrongBareIdentifier(value: string): boolean {
  if (value.length >= 5) return true;
  if (/[a-z]/i.test(value) && /\d/.test(value)) return true;
  return /[-_/]/.test(value);
}

const ORDER_WORD = '(?:order|purchase|bestellung|commande|pedido|(?:meg)?rendeles[a-z]{0,14})';
const IDENTIFIER = '([A-Z0-9][A-Z0-9._/-]{3,39})';

const PATTERNS: Array<{
  pattern: RegExp;
  qualifier: string;
  confidence: number;
  requireStrongBare?: boolean;
}> = [
  {
    pattern: new RegExp(`\\b${ORDER_WORD}\\s*(?:number|no\\.?|nr\\.?|id|szam|szama|azonosito|azonositoja|reference|ref\\.?)\\s*[:#-]?\\s*#?${IDENTIFIER}\\b`, 'gi'),
    qualifier: 'explicit_order_label',
    confidence: 0.995,
  },
  {
    pattern: new RegExp(`\\b(?:rendelesi|megrendelesi)\\s+(?:szam(?:a)?|azonosito(?:ja)?)\\s*[:#-]?\\s*#?${IDENTIFIER}\\b`, 'gi'),
    qualifier: 'explicit_order_label',
    confidence: 0.995,
  },
  {
    pattern: new RegExp(`\\b(?:order\\s+confirmation|(?:meg)?rendeles[a-z]{0,10}\\s+visszaigazolas[a-z]{0,8}|bestellbestatigung|confirmation\\s+de\\s+commande|confirmacion\\s+de\\s+pedido)\\s*[:#-]?\\s*#?${IDENTIFIER}\\b`, 'gi'),
    qualifier: 'explicit_order_confirmation_label',
    confidence: 0.995,
  },
  {
    pattern: new RegExp(`\\b${ORDER_WORD}\\s*#\\s*${IDENTIFIER}\\b`, 'gi'),
    qualifier: 'explicit_order_hash',
    confidence: 0.995,
  },
  {
    pattern: new RegExp(`(?:^|\\b)(?:a\\s+)?#?${IDENTIFIER}\\s+szamu\\s+${ORDER_WORD}\\b`, 'gi'),
    qualifier: 'numbered_order_phrase',
    confidence: 0.995,
  },
  {
    pattern: new RegExp(`\\b${ORDER_WORD}\\s+${IDENTIFIER}\\b`, 'gi'),
    qualifier: 'bare_order_identifier_after_noun',
    confidence: 0.985,
    requireStrongBare: true,
  },
  {
    pattern: new RegExp(`\\b${IDENTIFIER}\\s+${ORDER_WORD}(?:\\s*\\/\\s*(?:booking|foglalas))?\\b`, 'gi'),
    qualifier: 'contextual_order_identifier_before_noun',
    confidence: 0.96,
    requireStrongBare: true,
  },
];

export function extractUniversalOrderIdentityV2(text: string): UniversalOrderIdentityMatchV2[] {
  const normalized = normalizeText(text);
  const best = new Map<string, UniversalOrderIdentityMatchV2>();

  for (const definition of PATTERNS) {
    definition.pattern.lastIndex = 0;
    for (const match of normalized.matchAll(definition.pattern)) {
      const value = normalizeUniversalOrderIdentifierV2(match[1] ?? '');
      if (!value) continue;
      if (definition.requireStrongBare && !isStrongBareIdentifier(value)) continue;

      const key = value.toUpperCase();
      const current = best.get(key);
      const candidate: UniversalOrderIdentityMatchV2 = {
        value,
        qualifier: definition.qualifier,
        confidence: definition.confidence,
      };
      if (!current || candidate.confidence > current.confidence) best.set(key, candidate);
    }
  }

  return [...best.values()];
}

export function hasUniversalOrderIdentityV2(text: string): boolean {
  return extractUniversalOrderIdentityV2(text).length > 0;
}
