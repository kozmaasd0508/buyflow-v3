import type {
  EmailStructuredDataRecord,
  NormalizedEmailLink,
} from './document-v1.js';

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&#([0-9]{1,7});?/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function safeHttpUrl(value: string): string | null {
  const trimmed = decodeBasicHtmlEntities(value.trim()).replace(/[),.;]+$/, '');
  if (!trimmed || trimmed.length > 4096) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function compactText(value: string): string | null {
  const text = decodeBasicHtmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 300) : null;
}

function collectStructuredUrls(
  value: unknown,
  output: string[],
  seen: Set<object>,
  depth: number,
) {
  if (depth > 8 || output.length >= 100 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    const url = safeHttpUrl(value);
    if (url) output.push(url);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredUrls(item, output, seen, depth + 1);
    return;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectStructuredUrls(nested, output, seen, depth + 1);
  }
}

/**
 * Extracts only absolute HTTP(S) links. javascript:, data:, mailto: and malformed
 * hrefs are ignored. The result is bounded and deduplicated by normalized URL.
 */
export function extractNormalizedEmailLinks(input: {
  bodyHtml?: string | null;
  bodyText?: string | null;
  structuredData?: EmailStructuredDataRecord[];
  maxLinks?: number;
}): NormalizedEmailLink[] {
  const maxLinks = Math.min(Math.max(input.maxLinks ?? 100, 1), 500);
  const links = new Map<string, NormalizedEmailLink>();

  if (input.bodyHtml) {
    const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    const hrefRegex = /\bhref\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i;
    const relRegex = /\brel\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/i;
    for (const match of input.bodyHtml.matchAll(anchorRegex)) {
      if (links.size >= maxLinks) break;
      const attributes = match[1] ?? '';
      const hrefMatch = attributes.match(hrefRegex);
      const href = safeHttpUrl(hrefMatch?.[1] ?? hrefMatch?.[2] ?? '');
      if (!href || links.has(href)) continue;
      const relMatch = attributes.match(relRegex);
      const relRaw = relMatch?.[1] ?? relMatch?.[2] ?? '';
      const rel = [...new Set(relRaw.split(/\s+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
      const text = compactText(match[2] ?? '');
      links.set(href, {
        href,
        ...(text ? { text } : {}),
        ...(rel.length > 0 ? { rel } : {}),
        source: 'body_html',
      });
    }
  }

  if (input.bodyText && links.size < maxLinks) {
    const urlRegex = /https?:\/\/[^\s<>"']+/gi;
    for (const match of input.bodyText.matchAll(urlRegex)) {
      if (links.size >= maxLinks) break;
      const href = safeHttpUrl(match[0] ?? '');
      if (!href || links.has(href)) continue;
      links.set(href, { href, source: 'body_text' });
    }
  }

  if (input.structuredData && links.size < maxLinks) {
    const structuredUrls: string[] = [];
    for (const record of input.structuredData) {
      collectStructuredUrls(record.payload, structuredUrls, new Set<object>(), 0);
      if (structuredUrls.length >= 100) break;
    }
    for (const href of structuredUrls) {
      if (links.size >= maxLinks) break;
      if (!links.has(href)) links.set(href, { href, source: 'structured_data' });
    }
  }

  return [...links.values()];
}
