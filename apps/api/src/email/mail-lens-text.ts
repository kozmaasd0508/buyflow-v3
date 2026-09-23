import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { NormalizedEmail } from './types.js';

export const MAIL_LENS_TEXT_VERSION = 'mail-lens-text-v3';

type Node = DefaultTreeAdapterMap['node'];
const BLOCKS = new Set(['address', 'article', 'blockquote', 'div', 'footer', 'h1', 'h2', 'h3', 'header', 'li', 'p', 'section', 'table', 'tr']);
const NON_TEXT = new Set(['script', 'style', 'template', 'head', 'title', 'noscript']);

const IMPORTANT_URL_PARAM = /^(?:id|order(?:id|_id|number)?|tracking(?:id|_id|number)?|track(?:id|_id)?|shipment(?:id|_id)?|parcel(?:id|_id)?|product(?:id|_id)?|sku|ref|reference|code|searchvalue)$/i;
const USEFUL_PATH_HINT = /(?:order|track|product|item|shipment|parcel|invoice|receipt|refund|delivery|szamla|rendel|csomag)/i;

function compactEvidenceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    if (url.href.length <= 240) return url.href;

    const usefulParams = [...url.searchParams.entries()]
      .filter(([key]) => IMPORTANT_URL_PARAM.test(key))
      .slice(0, 4)
      .map(([key, value]) => [key, value.slice(0, 96)] as const);

    let path = url.pathname || '/';
    if (path.length > 120 && !USEFUL_PATH_HINT.test(path)) path = '/…';
    else if (path.length > 160) path = path.slice(0, 159) + '…';

    const query = usefulParams.length ? '?' + new URLSearchParams(usefulParams).toString() : '';
    return url.origin + path + query;
  } catch {
    return '';
  }
}

function compactSemanticUrls(text: string): { text: string; count: number } {
  let count = 0;
  const compacted = text.replace(/https?:\/\/[^\s<>"'\])]+/gi, (raw) => {
    const next = compactEvidenceUrl(raw);
    if (next && next !== raw) count += 1;
    return next || raw;
  });
  return { text: compacted, count };
}

function trimKnownLegalBoilerplate(text: string): { text: string; trimmed: boolean } {
  const markers = [
    /\nÁLTALÁNOS SZERZŐDÉSI FELTÉTELEK\n/iu,
    /\nGENERAL TERMS AND CONDITIONS\n/iu,
    /\nTERMS AND CONDITIONS\n/iu,
  ];
  let boundary = -1;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && match.index >= 800 && (boundary < 0 || match.index < boundary)) boundary = match.index;
  }
  if (boundary < 0) return { text, trimmed: false };
  return { text: tidy(text.slice(0, boundary)), trimmed: true };
}


function tidy(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function currentText(text: string): { text: string; quoted: boolean } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const value = line.trim();
    const headerWindow = lines.slice(index, index + 8).join("\n");
    const quotedHeaders = /^(?:from|feladó|felado)\s*:/i.test(value)
      && /(?:^|\n)\s*(?:to|címzett|cimzett)\s*:/i.test(headerWindow)
      && /(?:^|\n)\s*(?:subject|tárgy|targy)\s*:/i.test(headerWindow);
    // Strong reply headers establish the boundary even for an empty/short reply.
    if (quotedHeaders || /^begin forwarded message\s*:\s*$/i.test(value) || /^-{2,}\s*(?:original message|forwarded message|eredeti üzenet|eredeti uzenet)\s*-{2,}$/i.test(value)
      || /^on .{3,200} wrote:\s*$/i.test(value)
      || /^am .{3,200} schrieb .{0,80}:\s*$/i.test(value)
      || /^le .{3,200} a écrit\s*:\s*$/i.test(value)
      || /^el .{3,200} escribió\s*:\s*$/i.test(value)
      || /\bezt (?:írta|irta)\s*(?:\(|:)/i.test(value)) {
      return { text: tidy(output.join('\n')), quoted: true };
    }
    output.push(line);
  }
  // Remove explicitly quoted lines, preserving interleaved authored replies.
  return { text: tidy(lines.filter(line => !/^\s*>/.test(line)).join('\n')),
    quoted: lines.some(line => /^\s*>/.test(line)) };
}

function isPlaceholder(text: string): boolean {
  return /^(?:please\s+)?(?:view|read|see)(?:\s+this\s+(?:email|message))?\s+(?:in\s+)?(?:the\s+)?html(?:\s+version)?[.!]?$/i.test(text)
    || /^(?:this (?:email|message) (?:is|was) (?:in|sent in) html(?: format)?)[.!]?$/i.test(text)
    || /^(?:kérjük[,!]?\s*)?(?:tekintse|nyissa) meg (?:a|az) html[- ]változat(?:ot)?[.!]?$/i.test(text);
}

function htmlText(html: string) {
  const root = parseFragment(html);
  const full: string[] = [];
  const authored: string[] = [];
  let hidden = false;
  let quoted = false;
  const append = (text: string, inQuote: boolean) => {
    full.push(text);
    if (!inQuote) authored.push(text);
  };
  // Iterative traversal also tolerates deeply nested provider HTML.
  const stack: Array<{ node: Node; inQuote: boolean; close?: boolean }> =
    [...root.childNodes].reverse().map(node => ({ node, inQuote: false }));
  while (stack.length) {
    const { node, inQuote, close } = stack.pop()!;
    if (node.nodeName === '#text') {
      append((node as DefaultTreeAdapterMap['textNode']).value, inQuote);
      continue;
    }
    if (!('tagName' in node)) continue;
    const tag = node.tagName;
    const attrs = new Map(node.attrs.map(attr => [attr.name, attr.value]));
    if (close) {
      if (tag === 'a') {
        try {
          const url = new URL(attrs.get('href') ?? '');
          if (['https:', 'http:'].includes(url.protocol) && url.href.length <= 4096) append(` [URL: ${url.href}]`, inQuote);
        } catch { /* Relative and unsafe URLs are not evidence. */ }
      }
      if (BLOCKS.has(tag) || tag === 'td' || tag === 'th') append(tag === 'td' || tag === 'th' ? ' ' : '\n', inQuote);
      continue;
    }
    const style = (attrs.get('style') ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (NON_TEXT.has(tag) || attrs.has('hidden') || attrs.get('aria-hidden')?.trim().toLowerCase() === 'true'
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\s*(?:!important\s*)?(?:;|$)/i.test(style)) {
      hidden = true;
      continue; // Skip the entire subtree, including nested elements of the same tag.
    }
    const classes = (attrs.get('class') ?? '').split(/\s+/);
    const isQuote = inQuote || tag === 'blockquote'
      || classes.some(name => ['gmail_quote', 'yahoo_quoted', 'protonmail_quote'].includes(name))
      || attrs.get('type')?.toLowerCase() === 'cite';
    if (isQuote) quoted = true;
    if (BLOCKS.has(tag) || tag === 'br') append('\n', isQuote);
    stack.push({ node, inQuote: isQuote, close: true });
    for (const child of [...node.childNodes].reverse()) stack.push({ node: child, inQuote: isQuote });
  }
  const current = currentText(tidy(authored.join('')));
  return { bodyText: tidy(full.join('')), semanticText: current.text, hidden, quoted: quoted || current.quoted };
}

/** Raw provider HTML stays on the email; only this explicit semantic view goes to AI. */
export function normalizeMailLensText(email: Pick<NormalizedEmail, 'bodyText' | 'bodyHtml' | 'snippet'>, maxChars = 20_000) {
  const limit = Number.isFinite(maxChars) ? Math.max(1, Math.min(100_000, Math.floor(maxChars))) : 20_000;
  const plain = email.bodyText?.trim() ?? '';
  const html = email.bodyHtml ? htmlText(email.bodyHtml) : null;
  const usePlain = Boolean(plain && !(isPlaceholder(plain) && html?.bodyText));
  const source = usePlain ? 'provider_plain' : html ? 'html_derived' : email.snippet?.trim() ? 'snippet_fallback' : 'none';
  const body = usePlain ? plain : html ? html.bodyText : email.snippet?.trim() ?? '';
  const current = usePlain || !html ? currentText(body) : { text: html.semanticText, quoted: html.quoted };
  const boilerplate = trimKnownLegalBoilerplate(current.text);
  const compacted = compactSemanticUrls(boilerplate.text);
  return {
    bodyText: body.slice(0, limit),
    // Empty means no authored evidence. Never fall back to the quoted body/snippet.
    semanticText: compacted.text.slice(0, limit),
    normalization: {
      version: MAIL_LENS_TEXT_VERSION,
      bodyTextSource: source,
      bodyTextTruncated: body.length > limit,
      semanticTextTruncated: compacted.text.length > limit,
      hiddenHtmlRemoved: Boolean(!usePlain && html?.hidden),
      quotedHistoryDetected: current.quoted,
      providerPlaceholderIgnored: Boolean(plain && !usePlain && html),
      semanticUrlsCompacted: compacted.count,
      legalBoilerplateTrimmed: boilerplate.trimmed,
    },
  };
}
