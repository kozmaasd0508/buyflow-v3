import type { EmailDocumentV1 } from './email-document.js';
import {
  evaluateUniversalCommerceSemanticsV1,
  type UniversalSemanticAction,
  type UniversalSemanticModifier,
  type UniversalSemanticObject,
} from './universal-commerce-semantics-v1.js';

export const UNIVERSAL_COMMERCE_SEMANTICS_V1_1_VERSION = 'universal-commerce-semantics-v1.1';

export type UniversalSemanticActionV11 = UniversalSemanticAction | 'ATTACH' | 'MAKE_AVAILABLE';

export interface UniversalCommerceSemanticsV11Result {
  version: typeof UNIVERSAL_COMMERCE_SEMANTICS_V1_1_VERSION;
  objects: UniversalSemanticObject[];
  actions: UniversalSemanticActionV11[];
  modifiers: UniversalSemanticModifier[];
  visibleEvidence: string[];
  technicalEvidence: string[];
  corroboratedEvidence: string[];
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒–—]/g, '-')
    .toLowerCase();
}

function stripTechnicalUrls(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ');
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

const RECEIVE_VARIANTS = /\b(?:megerkezett|erkezett|beerkezett|megkaptuk|received|arrived|eingegangen|erhalten|recu|recibido|recibida)\b/i;
const ISSUE_VARIANTS = /\b(?:kiallitva|kiallitott|elkeszult|issued|ausgestellt|erstellt|emise|emis|emitida|emitido)\b/i;
const ATTACH_VARIANTS = /\b(?:mellekelt|mellekelten|mellekletben|csatolt|csatolva|csatolmanykent|csatolmanyban|csatolmanyaban|attached|attachment|enclosed|anbei|angehangt|beigefugt|joint|jointe|piece jointe|adjunto|adjunta)\b/i;
const AVAILABLE_VARIANTS = /\b(?:elerheto|erheto el|letoltheto|letoltes|tolthet le|megtekintheto|megtekintheted|megtekintheti|megtekintes|available|downloadable|download|viewable|view online|verfugbar|herunterladen|abrufbar|disponible|telecharger|consultable|descargar|visualizar)\b/i;

function augmentTechnicalInvoiceEvidence(document: EmailDocumentV1, evidence: string[]): string[] {
  const html = normalize(document.html ?? '');
  const additions: string[] = [];
  if (/(?:\/e-?szamla\/|\/eszamla\/|\/invoice\/|\/invoices\/|\/rechnung\/|\/facture\/|\/factura\/)/i.test(html)) {
    additions.push('url_invoice_document');
  }
  if (/(?:invoice[-_:]?(?:download|view|document)|e[-_:]?invoice|eszamla|e[-_:]?szamla)/i.test(html)) {
    additions.push('technical_invoice_document');
  }
  return unique([...evidence, ...additions]);
}

export function evaluateUniversalCommerceSemanticsV11(
  document: EmailDocumentV1,
): UniversalCommerceSemanticsV11Result {
  const base = evaluateUniversalCommerceSemanticsV1(document);
  const visibleText = normalize(`${document.subject ?? ''}\n${stripTechnicalUrls(document.text)}`);
  const actions: UniversalSemanticActionV11[] = [...base.actions];
  const visibleEvidence = [...base.visibleEvidence];

  if (RECEIVE_VARIANTS.test(visibleText)) {
    actions.push('RECEIVE');
    visibleEvidence.push('visible_receive');
  }
  if (ISSUE_VARIANTS.test(visibleText)) {
    actions.push('ISSUE');
    visibleEvidence.push('visible_issue');
  }
  if (ATTACH_VARIANTS.test(visibleText)) {
    actions.push('ATTACH');
    visibleEvidence.push('visible_attach');
  }
  if (AVAILABLE_VARIANTS.test(visibleText)) {
    actions.push('MAKE_AVAILABLE');
    visibleEvidence.push('visible_make_available');
  }

  return {
    version: UNIVERSAL_COMMERCE_SEMANTICS_V1_1_VERSION,
    objects: base.objects,
    actions: unique(actions),
    modifiers: base.modifiers,
    visibleEvidence: unique(visibleEvidence),
    technicalEvidence: augmentTechnicalInvoiceEvidence(document, base.technicalEvidence),
    corroboratedEvidence: base.corroboratedEvidence,
  };
}
