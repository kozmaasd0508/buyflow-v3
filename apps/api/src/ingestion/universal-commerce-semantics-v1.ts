import type { EmailDocumentV1 } from './email-document.js';

export const UNIVERSAL_COMMERCE_SEMANTICS_V1_VERSION = 'universal-commerce-semantics-v1';

export type UniversalSemanticObject =
  | 'ORDER'
  | 'PAYMENT'
  | 'SHIPMENT'
  | 'DELIVERY'
  | 'INVOICE'
  | 'REFUND'
  | 'RETURN'
  | 'PRODUCT'
  | 'CARRIER';

export type UniversalSemanticAction =
  | 'CREATE'
  | 'CONFIRM'
  | 'RECEIVE'
  | 'PROCESS'
  | 'PACK'
  | 'HANDOFF_TO_CARRIER'
  | 'MOVE'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVER'
  | 'CANCEL'
  | 'PAY_SUCCESS'
  | 'PAY_FAIL'
  | 'ISSUE'
  | 'REFUND'
  | 'RETURN';

export type UniversalSemanticModifier =
  | 'COMPLETED'
  | 'CURRENT'
  | 'FUTURE'
  | 'NEGATED'
  | 'CONDITIONAL';

export interface UniversalCommerceSemanticsV1Result {
  version: typeof UNIVERSAL_COMMERCE_SEMANTICS_V1_VERSION;
  objects: UniversalSemanticObject[];
  actions: UniversalSemanticAction[];
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

function has(pattern: RegExp, value: string): boolean {
  return pattern.test(value);
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

const VISIBLE_OBJECTS: Array<[UniversalSemanticObject, RegExp]> = [
  ['ORDER', /\b(?:(?:meg)?rendeles(?:ed(?:et)?|e(?:t)?|unk(?:et)?|uk(?:et)?)?|order|bestellung|commande|pedido)\b/i],
  ['PAYMENT', /\b(?:fizetes(?:ed|e|t)?|tranzakcio(?:d|ja|t)?|payment|zahlung|paiement|pago)\b/i],
  ['SHIPMENT', /\b(?:csomag(?:od(?:at)?|ja(?:t)?|unk(?:at)?|ot)?|kuldemeny(?:ed(?:et)?|e(?:t)?|unk(?:et)?)?|shipment|parcel|sendung|paket|colis|paquete|envio)\b/i],
  ['DELIVERY', /\b(?:kezbesites(?:e|ed|t)?|delivery|zustellung|livraison|entrega)\b/i],
  ['INVOICE', /\b(?:szamla(?:d|ja|t)?|invoice|rechnung|facture|factura)\b/i],
  ['REFUND', /\b(?:visszaterites(?:ed|e|t)?|visszafizetes(?:ed|e|t)?|refund|ruckerstattung|remboursement|reembolso)\b/i],
  ['RETURN', /\b(?:visszakuldes(?:ed|e|t)?|elallas(?:i)?|return|retoure|rucksendung|retour|devolucion)\b/i],
  ['PRODUCT', /\b(?:termek(?:ed|e|et|ek)?|product|artikel|produit|producto)\b/i],
  ['CARRIER', /\b(?:futar(?:nak|ral|hoz|szolgalat(?:nak|tal)?)?|carrier|courier|transportdienstleister|transporteur|transportista)\b/i],
];

const VISIBLE_ACTIONS: Array<[UniversalSemanticAction, RegExp]> = [
  ['CREATE', /\b(?:letrejott|rogzitettuk|rogzitve|created|placed|erstellt|cree|creada|creado)\b/i],
  ['CONFIRM', /\b(?:visszaigazol\w*|megerosit\w*|confirm(?:ed|ation)?|bestatig\w*|confirme\w*|confirmad[oa])\b/i],
  ['RECEIVE', /\b(?:megkaptuk|beerkezett|received|eingegangen|recu|recibido)\b/i],
  ['PROCESS', /\b(?:feldolgoz\w*|processing|bearbeit\w*|traitement|procesando)\b/i],
  ['PACK', /\b(?:osszekeszit\w*|csomagol\w*|packing|packed|being packed|verpack\w*|prepar\w*|empaquet\w*)\b/i],
  ['HANDOFF_TO_CARRIER', /\b(?:atad(?:tuk|juk)|atadasra kerult|handed to (?:the )?carrier|handed over to (?:the )?carrier|ubergeben.{0,40}(?:dienstleister|carrier)|remis.{0,40}transporteur|entregado.{0,40}transportista)\b/i],
  ['MOVE', /\b(?:uton van|szallitas alatt|in transit|unterwegs|en transit|en transito)\b/i],
  ['OUT_FOR_DELIVERY', /\b(?:kezbesitonel|kezbesites alatt|ma kezbesit\w*|out for delivery|in zustellung|en cours de livraison|en reparto)\b/i],
  ['DELIVER', /\b(?:kezbesitve|kezbesitettuk|delivery completed|delivered|zugestellt|livre|entregado)\b/i],
  ['CANCEL', /\b(?:torolve|toroltuk|megszunt|cancelled|canceled|storniert|annule|cancelad[oa])\b/i],
  ['PAY_SUCCESS', /\b(?:sikeres fizetes|fizetes sikeres|tranzakcio sikeres|payment successful|payment completed|zahlung erfolgreich|paiement reussi|pago confirmado|pago completado)\b/i],
  ['PAY_FAIL', /\b(?:sikertelen fizetes|fizetes sikertelen|payment failed|payment unsuccessful|zahlung fehlgeschlagen|paiement echoue|pago fallido)\b/i],
  ['ISSUE', /\b(?:kiallitva|elkeszult|issued|ausgestellt|emise|emitida)\b/i],
  ['REFUND', /\b(?:visszaterites.{0,50}(?:megtortent|feldolgozva|elindult)|refund.{0,50}(?:issued|processed|completed)|ruckerstattung.{0,50}(?:erfolgt|bearbeitet)|remboursement.{0,50}(?:effectue|traite)|reembolso.{0,50}(?:emitido|procesado))\b/i],
  ['RETURN', /\b(?:visszakuldes.{0,50}(?:elindult|elfogadva|beerkezett)|return.{0,50}(?:started|approved|received)|retoure.{0,50}(?:gestartet|erhalten)|retour.{0,50}(?:accepte|recu)|devolucion.{0,50}(?:iniciada|recibida))\b/i],
];

const FUTURE_PATTERN = /\b(?:hamarosan|rovidesen|majd|fogjuk|atadjuk|will|soon|going to|wird|werden|bientot|sera|se entregara|sera entregado)\b/i;
const NEGATED_PATTERN = /\b(?:nem|nincs|meg nem|not|no longer|has not|have not|nicht|kein|pas encore|ne pas|no se ha|todavia no)\b/i;
const CONDITIONAL_PATTERN = /\b(?:ha|amennyiben|if|when possible|falls|wenn|si|lorsque)\b/i;
const COMPLETED_PATTERN = /\b(?:megtortent|sikeresen|atadtuk|kezbesitve|completed|successful|handed|delivered|erfolgt|erfolgreich|zugestellt|effectue|livre|completado|entregado)\b/i;

const TECHNICAL_MARKERS: Array<[UniversalSemanticObject | 'HANDOFF_TO_CARRIER', RegExp, string]> = [
  ['ORDER', /(?:data[-_:]?order[-_:]?id|order[-_:]?(?:number|no|id|status|summary|details)|woocommerce[-_:]?order|shopify[-_:]?order|parent_order_sn)/i, 'technical_order'],
  ['PRODUCT', /(?:order[-_:]?item|line[-_:]?item|product[-_:]?(?:name|row)|item[-_:]?quantity|\bquantity\b|woocommerce[-_:]?price[-_:]?amount)/i, 'technical_product'],
  ['PAYMENT', /(?:payment[-_:]?(?:method|status|reference)|transaction[-_:]?id|paid[-_:]?status)/i, 'technical_payment'],
  ['SHIPMENT', /(?:shipping[-_:]?(?:method|status)|shipment[-_:]?(?:status|id)|tracking[-_:]?(?:number|no|id)|fulfill(?:ment|ment_status))/i, 'technical_shipment'],
  ['DELIVERY', /(?:delivery[-_:]?(?:status|method|date)|out[-_:]?for[-_:]?delivery)/i, 'technical_delivery'],
  ['INVOICE', /(?:invoice[-_:]?(?:number|no|id|status)|billing[-_:]?document)/i, 'technical_invoice'],
  ['REFUND', /(?:refund[-_:]?(?:status|amount|id)|refunded[-_:]?amount)/i, 'technical_refund'],
  ['RETURN', /(?:return[-_:]?(?:status|request|id)|rma[-_:]?(?:id|status))/i, 'technical_return'],
  ['CARRIER', /(?:carrier[-_:]?(?:name|code)|shipping[-_:]?provider|courier[-_:]?(?:name|code))/i, 'technical_carrier'],
  ['ORDER', /["']@type["']\s*:\s*["']Order["']/i, 'structured_schema_order'],
  ['SHIPMENT', /["']@type["']\s*:\s*["']ParcelDelivery["']/i, 'structured_schema_parcel_delivery'],
  ['ORDER', /["']orderNumber["']\s*:/i, 'structured_order_number'],
  ['SHIPMENT', /["']trackingNumber["']\s*:/i, 'structured_tracking_number'],
  ['ORDER', /["']orderStatus["']\s*:/i, 'structured_order_status'],
  ['HANDOFF_TO_CARRIER', /(?:fulfillment[-_:]?status.{0,30}(?:fulfilled|shipped)|order[-_:]?status.{0,30}shipped)/i, 'technical_handoff_completed'],
];

const URL_MARKERS: Array<[UniversalSemanticObject, RegExp, string]> = [
  ['ORDER', /(?:\/orders?\/|\/order[-_]?status\b|[?&](?:order_id|order_number|parent_order_sn)=)/i, 'url_order'],
  ['SHIPMENT', /(?:\/track(?:ing)?\/|\/shipment\/|[?&](?:tracking|tracking_number|shipment_id)=)/i, 'url_shipment'],
  ['INVOICE', /(?:\/invoice\/|[?&](?:invoice_id|invoice_number)=)/i, 'url_invoice'],
  ['RETURN', /(?:\/returns?\/|\/rma\/)/i, 'url_return'],
  ['REFUND', /(?:\/refunds?\/)/i, 'url_refund'],
];

function visibleSemantics(text: string) {
  const objects: UniversalSemanticObject[] = [];
  const actions: UniversalSemanticAction[] = [];
  const evidence: string[] = [];

  for (const [object, pattern] of VISIBLE_OBJECTS) {
    if (has(pattern, text)) {
      objects.push(object);
      evidence.push(`visible_${object.toLowerCase()}`);
    }
  }
  for (const [action, pattern] of VISIBLE_ACTIONS) {
    if (has(pattern, text)) {
      actions.push(action);
      evidence.push(`visible_${action.toLowerCase()}`);
    }
  }

  return { objects: unique(objects), actions: unique(actions), evidence: unique(evidence) };
}

function technicalSemantics(html: string | null) {
  const source = normalize(html ?? '');
  const objects: UniversalSemanticObject[] = [];
  const actions: UniversalSemanticAction[] = [];
  const evidence: string[] = [];

  for (const [semantic, pattern, evidenceName] of TECHNICAL_MARKERS) {
    if (!has(pattern, source)) continue;
    evidence.push(evidenceName);
    if (semantic === 'HANDOFF_TO_CARRIER') actions.push(semantic);
    else objects.push(semantic);
  }

  const hrefs = [...source.matchAll(/href\s*=\s*["']([^"']{1,2000})["']/gi)]
    .map((match) => match[1] ?? '')
    .slice(0, 100);
  for (const href of hrefs) {
    for (const [object, pattern, evidenceName] of URL_MARKERS) {
      if (has(pattern, href)) {
        objects.push(object);
        evidence.push(evidenceName);
      }
    }
  }

  return { objects: unique(objects), actions: unique(actions), evidence: unique(evidence) };
}

function modifiers(text: string, actions: UniversalSemanticAction[]): UniversalSemanticModifier[] {
  const values: UniversalSemanticModifier[] = [];
  if (has(FUTURE_PATTERN, text)) values.push('FUTURE');
  if (has(NEGATED_PATTERN, text)) values.push('NEGATED');
  if (has(CONDITIONAL_PATTERN, text)) values.push('CONDITIONAL');
  if (has(COMPLETED_PATTERN, text) || actions.some((action) => [
    'DELIVER', 'CANCEL', 'PAY_SUCCESS', 'PAY_FAIL', 'REFUND', 'RETURN',
  ].includes(action))) values.push('COMPLETED');
  if (values.length === 0) values.push('CURRENT');
  return unique(values);
}

export function evaluateUniversalCommerceSemanticsV1(
  document: EmailDocumentV1,
): UniversalCommerceSemanticsV1Result {
  const visibleText = normalize(`${document.subject ?? ''}\n${document.text}`);
  const visible = visibleSemantics(visibleText);
  const technical = technicalSemantics(document.html);
  const allObjects = unique([...visible.objects, ...technical.objects]);
  const allActions = unique([...visible.actions, ...technical.actions]);

  const corroboratedEvidence: string[] = [];
  for (const object of allObjects) {
    if (visible.objects.includes(object) && technical.objects.includes(object)) {
      corroboratedEvidence.push(`visible_plus_technical_${object.toLowerCase()}`);
    }
  }

  if (
    allActions.includes('HANDOFF_TO_CARRIER') &&
    visible.objects.some((object) => object === 'ORDER' || object === 'SHIPMENT') &&
    technical.objects.some((object) => object === 'ORDER' || object === 'SHIPMENT')
  ) {
    corroboratedEvidence.push('handoff_cross_layer_corroborated');
  }

  return {
    version: UNIVERSAL_COMMERCE_SEMANTICS_V1_VERSION,
    objects: allObjects,
    actions: allActions,
    modifiers: modifiers(visibleText, allActions),
    visibleEvidence: visible.evidence,
    technicalEvidence: technical.evidence,
    corroboratedEvidence: unique(corroboratedEvidence),
  };
}
