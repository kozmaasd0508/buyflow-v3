import { registeredProtocolProfiles } from './registry.js';
import { protocolEvidenceMayEnterAutomaticDecision } from './safety.js';
import type {
  ProtocolDetectionInput,
  ProtocolEvidence,
  ProtocolEvidenceField,
  ProtocolIdentifiers,
  ProtocolMatchedEvidence,
  ProtocolPatternRule,
  ProtocolProfile,
  ProtocolProvenanceLevel,
} from './types.js';

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function domainMatchesTrustedSuffix(candidate: string, trusted: string): boolean {
  const normalizedCandidate = normalizeDomain(candidate);
  const normalizedTrusted = normalizeDomain(trusted);
  return normalizedCandidate === normalizedTrusted
    || normalizedCandidate.endsWith(`.${normalizedTrusted}`);
}

function profileSenderGate(profile: ProtocolProfile, input: ProtocolDetectionInput): boolean {
  if (profile.sender_domains.length > 0) {
    const senderMatch = input.senderDomains.some((candidate) =>
      profile.sender_domains.some((trusted) => domainMatchesTrustedSuffix(candidate, trusted))
    );
    if (!senderMatch) return false;
  }

  if ((profile.sender_addresses?.length ?? 0) > 0) {
    const allowed = new Set(profile.sender_addresses!.map((value) => value.trim().toLowerCase()));
    const senderMatch = (input.senderAddresses ?? [])
      .some((value) => allowed.has(value.trim().toLowerCase()));
    if (!senderMatch) return false;
  }

  return true;
}

function valuesForField(input: ProtocolDetectionInput, field: ProtocolEvidenceField): string[] {
  switch (field) {
    case 'sender_domain': return input.senderDomains;
    case 'sender_address': return input.senderAddresses ?? [];
    case 'transport_host': return input.transportHosts ?? [];
    case 'dkim_domain': return input.dkimDomains ?? [];
    case 'return_path_domain': return input.returnPathDomains ?? [];
    case 'subject': return input.subject ? [input.subject] : [];
    case 'body': return input.bodyText ? [input.bodyText] : [];
    case 'html': return input.bodyHtml ? [input.bodyHtml] : [];
    case 'attachment_filename': return input.attachmentFilenames ?? [];
  }
}

function ruleMatches(rule: ProtocolPatternRule, input: ProtocolDetectionInput): boolean {
  const values = valuesForField(input, rule.field);
  return values.some((value) => new RegExp(rule.pattern, rule.flags ?? 'i').test(value));
}

function matchedEvidence(rule: ProtocolPatternRule): ProtocolMatchedEvidence {
  return {
    rule_id: rule.id,
    field: rule.field,
    source_ids: [...rule.source_ids],
  };
}

function provenanceForEvidence(
  profile: ProtocolProfile,
  evidence: ProtocolMatchedEvidence[],
): ProtocolProvenanceLevel[] {
  const sourceIds = new Set(evidence.flatMap((item) => item.source_ids));
  const levels = new Set<ProtocolProvenanceLevel>();
  for (const source of profile.sources) {
    if (sourceIds.has(source.id)) levels.add(source.provenance);
  }
  return [...levels];
}

function extractFirst(patterns: string[], input: string): string | null {
  for (const pattern of patterns) {
    const match = new RegExp(pattern, 'i').exec(input);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function extractIdentifiers(profile: ProtocolProfile, input: ProtocolDetectionInput): ProtocolIdentifiers {
  const text = [
    input.subject ?? '',
    input.bodyText ?? '',
    input.bodyHtml ?? '',
    ...(input.attachmentFilenames ?? []),
  ].join('\n');

  return {
    order_id: extractFirst(profile.identifier_patterns.order_id, text),
    tracking_id: extractFirst(profile.identifier_patterns.tracking_id, text),
    invoice_id: extractFirst(profile.identifier_patterns.invoice_id, text),
    payment_reference: extractFirst(profile.identifier_patterns.payment_reference, text),
  };
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function detectProtocolEvidence(
  input: ProtocolDetectionInput,
  profiles: readonly ProtocolProfile[] = registeredProtocolProfiles(),
): ProtocolEvidence[] {
  const results: ProtocolEvidence[] = [];

  for (const profile of profiles) {
    if (!profileSenderGate(profile, input)) continue;

    const profileNegative = (profile.negative_patterns ?? [])
      .filter((rule) => ruleMatches(rule, input))
      .map(matchedEvidence);

    for (const event of profile.events) {
      const requiredRules = event.positive_rules.filter((rule) => rule.required !== false);
      if (requiredRules.some((rule) => !ruleMatches(rule, input))) continue;

      const positiveMatches = event.positive_rules
        .filter((rule) => ruleMatches(rule, input))
        .map(matchedEvidence);
      if (positiveMatches.length === 0) continue;

      const eventNegative = (event.negative_rules ?? [])
        .filter((rule) => ruleMatches(rule, input))
        .map(matchedEvidence);
      const negativeMatches = [...profileNegative, ...eventNegative];
      const blockedByNegativeEvidence = negativeMatches.length > 0;

      const matchedPositiveRuleIds = new Set(positiveMatches.map((match) => match.rule_id));
      const confidenceDelta = event.positive_rules
        .filter((rule) => matchedPositiveRuleIds.has(rule.id))
        .reduce((total, rule) => total + (rule.confidence_delta ?? 0), 0);
      const confidence = clampConfidence(event.base_confidence + confidenceDelta);
      const provenanceLevels = provenanceForEvidence(profile, [
        ...positiveMatches,
        ...negativeMatches,
      ]);

      const candidate: ProtocolEvidence = {
        protocol_id: profile.protocol_id,
        protocol_version: profile.protocol_version,
        protocol_kind: profile.kind,
        event_candidate: event.event,
        confidence,
        identifiers: extractIdentifiers(profile, input),
        evidence: positiveMatches,
        negative_evidence: negativeMatches,
        blocked_by_negative_evidence: blockedByNegativeEvidence,
        prohibitions: [...(event.prohibitions ?? [])],
        provenance_levels: provenanceLevels,
        production_eligible: false,
      };

      candidate.production_eligible = protocolEvidenceMayEnterAutomaticDecision(profile, candidate);
      results.push(candidate);
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export const protocolDomainMatchesTrustedSuffix = domainMatchesTrustedSuffix;
