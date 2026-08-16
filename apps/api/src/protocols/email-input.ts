import type { EmailHeader, NormalizedEmail } from '../email/types.js';
import type { ProtocolDetectionInput } from './types.js';

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^<|>$/g, '')
    .replace(/\.$/, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeDomain).filter(Boolean))];
}

function domainOfAddress(value: string): string | null {
  const match = /@([^>\s,;]+)/.exec(value.trim());
  if (!match?.[1]) return null;
  return normalizeDomain(match[1]);
}

function headerValues(headers: EmailHeader[] | undefined, name: string): string[] {
  const wanted = name.toLowerCase();
  return (headers ?? [])
    .filter((header) => header.name.trim().toLowerCase() === wanted)
    .map((header) => header.value);
}

export function extractReturnPathDomains(headers?: EmailHeader[]): string[] {
  return unique(
    headerValues(headers, 'return-path')
      .map(domainOfAddress)
      .filter((value): value is string => Boolean(value)),
  );
}

function domainsFromDkimPassChunk(chunk: string): string[] {
  const domains: string[] = [];

  for (const pattern of [
    /\bheader\.d\s*=\s*([^\s;]+)/gi,
    /\bheader\.i\s*=\s*@?([^\s;]+)/gi,
  ]) {
    for (const match of chunk.matchAll(pattern)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      const domain = raw.includes('@') ? domainOfAddress(raw) : normalizeDomain(raw);
      if (domain) domains.push(domain);
    }
  }

  return domains;
}

export function extractDkimDomains(headers?: EmailHeader[]): string[] {
  const authenticationHeaders = [
    ...headerValues(headers, 'authentication-results'),
    ...headerValues(headers, 'arc-authentication-results'),
  ];
  const domains: string[] = [];

  for (const value of authenticationHeaders) {
    for (const match of value.matchAll(/(?:^|;)\s*dkim\s*=\s*pass\b([^;]*)/gi)) {
      domains.push(...domainsFromDkimPassChunk(match[1] ?? ''));
    }
  }

  return unique(domains);
}

export function extractTransportHosts(headers?: EmailHeader[]): string[] {
  const hosts: string[] = [];

  for (const value of headerValues(headers, 'received')) {
    const match = /\bfrom\s+([a-z0-9._-]+\.[a-z0-9._-]+)\b/i.exec(value);
    const host = match?.[1];
    if (!host) continue;
    hosts.push(host);
  }

  return unique(hosts);
}

function decodeHtmlEntity(entity: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  const lower = entity.toLowerCase();
  if (named[lower] !== undefined) return named[lower];

  if (/^#x[0-9a-f]+$/i.test(entity)) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    if (Number.isFinite(codePoint)) return String.fromCodePoint(codePoint);
  }

  if (/^#\d+$/.test(entity)) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    if (Number.isFinite(codePoint)) return String.fromCodePoint(codePoint);
  }

  return `&${entity};`;
}

export function htmlToProtocolText(html?: string | null): string | null {
  if (!html) return null;

  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([^;]{1,12});/g, (_whole, entity: string) => decodeHtmlEntity(entity))
    .replace(/[\t\r ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

export function protocolDetectionInputFromEmail(
  message: NormalizedEmail,
): ProtocolDetectionInput {
  const senderAddresses = message.from
    .map((sender) => sender.email.trim().toLowerCase())
    .filter(Boolean);
  const senderDomains = senderAddresses
    .map(domainOfAddress)
    .filter((value): value is string => Boolean(value));

  return {
    senderDomains: unique(senderDomains),
    senderAddresses: [...new Set(senderAddresses)],
    transportHosts: extractTransportHosts(message.headers),
    dkimDomains: extractDkimDomains(message.headers),
    returnPathDomains: extractReturnPathDomains(message.headers),
    subject: message.subject ?? null,
    bodyText: htmlToProtocolText(message.bodyHtml),
    bodyHtml: message.bodyHtml ?? null,
    attachmentFilenames: message.attachments
      .filter((attachment) => !attachment.isInline)
      .map((attachment) => attachment.filename)
      .filter(Boolean),
  };
}
