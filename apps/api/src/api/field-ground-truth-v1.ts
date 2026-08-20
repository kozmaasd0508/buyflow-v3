export type GroundTruthExpectation<T> =
  | { state: 'value'; value: T }
  | { state: 'null' }
  | { state: 'not_asserted' };

export interface FieldGroundTruthV1 {
  id: string;
  selector: { sender: string; subject: string };
  eventType: GroundTruthExpectation<string>;
  merchant: GroundTruthExpectation<string>;
  orderNumber: GroundTruthExpectation<string>;
  total: GroundTruthExpectation<number>;
  currency: GroundTruthExpectation<string>;
  carrier: GroundTruthExpectation<string>;
  trackingNumber: GroundTruthExpectation<string>;
  paymentStatus: GroundTruthExpectation<string>;
  products: GroundTruthExpectation<Array<{ name: string; quantity?: number }>>;
}

const NA = { state: 'not_asserted' } as const;
const value = <T>(v: T): GroundTruthExpectation<T> => ({ state: 'value', value: v });

export const FIELD_GROUND_TRUTH_V1: FieldGroundTruthV1[] = [
  { id:'gymbeam-invoice-3010410391', selector:{sender:'info@service.gymbeam.hu',subject:'Kozma a számlád elkészült! - 3010410391'}, eventType:value('invoice_or_receipt'), merchant:value('GymBeam'), orderNumber:value('3010410391'), total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:NA,products:NA },
  { id:'dpd-delivered-16380143879559', selector:{sender:'noreply@dpd.hu',subject:'Értesítés 16380143879559 sikeres kézbesítéséről'}, eventType:value('delivery'), merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('DPD'),trackingNumber:value('16380143879559'),paymentStatus:NA,products:NA },
  { id:'dpd-delivered-16380124260518', selector:{sender:'noreply@dpd.hu',subject:'Értesítés 16380124260518 sikeres kézbesítéséről'}, eventType:value('delivery'), merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('DPD'),trackingNumber:value('16380124260518'),paymentStatus:NA,products:NA },
  { id:'gls-locker-3408405568', selector:{sender:'noreply@gls-hungary.com',subject:'Értesítés a 3408405568 számú csomag GLS Automatába helyezéséről'}, eventType:value('shipment'), merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('GLS'),trackingNumber:value('3408405568'),paymentStatus:NA,products:NA },
  { id:'mpl-package-PB9S650295555', selector:{sender:'kozponti.ertesites@posta.hu',subject:'Csomagküldemény'}, eventType:value('shipment'), merchant:value('Szidibox Karton Kft.'),orderNumber:NA,total:NA,currency:NA,carrier:value('Magyar Posta'),trackingNumber:value('PB9S650295555'),paymentStatus:NA,products:NA },
  { id:'expressone-delay-669695091305000013605231', selector:{sender:'ertesites@expressone.hu',subject:'Késik a kézbesítés – új ETA: 5 perc'}, eventType:value('shipment'), merchant:value('Get-It-Now Trade'),orderNumber:NA,total:NA,currency:NA,carrier:value('Express One'),trackingNumber:value('669695091305000013605231'),paymentStatus:NA,products:NA },
  { id:'epic-receipt-A2605251823125756', selector:{sender:'help@acct.epicgames.com',subject:'Epic Games bizonylat'}, eventType:value('invoice_or_receipt'), merchant:value('Epic Games'),orderNumber:value('A2605251823125756'),total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:NA,products:NA },
];

export const FIELD_GROUND_TRUTH_V1_META = {
  version: 'field-ground-truth-v1', source: 'frozen-v7-commerce-mailbox', parserOutputUsedAsTruth: false,
  assertionPolicy: 'explicit-source-evidence-only', unassertedFieldsAreIgnored: true,
} as const;
