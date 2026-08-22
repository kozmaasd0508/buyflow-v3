declare module 'mailparser' {
  export interface ParsedAddressEntry {
    address?: string;
    name?: string;
  }

  export interface ParsedAddressObject {
    value?: ParsedAddressEntry[];
  }

  export interface ParsedAttachment {
    contentId?: string;
    filename?: string;
    contentType?: string;
    size: number;
    contentDisposition?: string;
    cid?: string;
  }

  export interface ParsedMail {
    attachments: ParsedAttachment[];
    html?: string | false;
    text?: string;
    date?: Date;
    messageId?: string;
    subject?: string;
    from?: ParsedAddressObject;
    to?: ParsedAddressObject | ParsedAddressObject[];
    cc?: ParsedAddressObject | ParsedAddressObject[];
    bcc?: ParsedAddressObject | ParsedAddressObject[];
    headers: Map<string, unknown>;
  }

  export interface SimpleParserOptions {
    skipHtmlToText?: boolean;
    skipTextToHtml?: boolean;
  }

  export function simpleParser(
    source: Buffer | string,
    options?: SimpleParserOptions,
  ): Promise<ParsedMail>;
}
