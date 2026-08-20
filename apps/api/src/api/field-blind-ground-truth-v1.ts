export type BlindExpectation<T> =
  | { state: 'value'; value: T }
  | { state: 'null' }
  | { state: 'not_asserted' };

export interface FieldBlindTruthV1 {
  id: string;
  selector: { sender: string; subject: string; contains?: string };
  eventType: BlindExpectation<string>;
  merchant: BlindExpectation<string>;
  orderNumber: BlindExpectation<string>;
  total: BlindExpectation<number>;
  currency: BlindExpectation<string>;
  carrier: BlindExpectation<string>;
  trackingNumber: BlindExpectation<string>;
  paymentStatus: BlindExpectation<string>;
  products: BlindExpectation<Array<{ name: string; quantity?: number }>>;
}

const NA = { state: 'not_asserted' } as const;
const value = <T>(v: T): BlindExpectation<T> => ({ state: 'value', value: v });

export const FIELD_BLIND_GROUND_TRUTH_V1: FieldBlindTruthV1[] = [
  { id:'barion-64357', selector:{sender:'barion@barion.com',subject:'Sikeres fizetés',contains:'64 357'}, eventType:value('payment_completed'),merchant:NA,orderNumber:NA,total:value(64357),currency:value('HUF'),carrier:NA,trackingNumber:NA,paymentStatus:value('paid'),products:NA },
  { id:'barion-4432', selector:{sender:'barion@barion.com',subject:'Sikeres fizetés',contains:'4 432'}, eventType:value('payment_completed'),merchant:NA,orderNumber:NA,total:value(4432),currency:value('HUF'),carrier:NA,trackingNumber:NA,paymentStatus:value('paid'),products:NA },
  { id:'barion-28574', selector:{sender:'barion@barion.com',subject:'Sikeres fizetés',contains:'28 574'}, eventType:value('payment_completed'),merchant:NA,orderNumber:NA,total:value(28574),currency:value('HUF'),carrier:NA,trackingNumber:NA,paymentStatus:value('paid'),products:NA },
  { id:'dpd-16408074681095-out', selector:{sender:'noreply@dpd.hu',subject:'Értesítés 16408074681095 Alza.hu küldemény mai kézbesítéséről'}, eventType:value('shipment'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('DPD'),trackingNumber:value('16408074681095'),paymentStatus:NA,products:NA },
  { id:'dpd-16408074681095-shipped', selector:{sender:'noreply@dpd.hu',subject:'Értesítés 16408074681095 Alza.hu küldemény feladásáról'}, eventType:value('shipment'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('DPD'),trackingNumber:value('16408074681095'),paymentStatus:NA,products:NA },
  { id:'dpd-16408074681095-pre', selector:{sender:'noreply@dpd.hu',subject:'Értesítés 16408074681095 küldemény feladásáról'}, eventType:value('shipment'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('DPD'),trackingNumber:value('16408074681095'),paymentStatus:NA,products:NA },
  { id:'gls-3396079237', selector:{sender:'noreply@gls-hungary.com',subject:'GLS csomag információ / GLS parcel information',contains:'3396079237'}, eventType:value('shipment'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('GLS'),trackingNumber:value('3396079237'),paymentStatus:NA,products:NA },
  { id:'expressone-605855680768000013605231', selector:{sender:'ertesites@expressone.hu',subject:'Küldemény kézbesítve – kérdőív',contains:'605855680768000013605231'}, eventType:value('delivery'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('Express One'),trackingNumber:value('605855680768000013605231'),paymentStatus:NA,products:NA },
  { id:'expressone-103365121467000013605231', selector:{sender:'ertesites@expressone.hu',subject:'Küldemény kézbesítve – kérdőív',contains:'103365121467000013605231'}, eventType:value('delivery'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:value('Express One'),trackingNumber:value('103365121467000013605231'),paymentStatus:NA,products:NA },
  { id:'sinsay-15709862007', selector:{sender:'noreply@sinsay.com',subject:'A 15709862007 rendelés megerősítése.'}, eventType:value('order_created'),merchant:NA,orderNumber:value('15709862007'),total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:NA,products:NA },
  { id:'utt-order-2026-8420-002', selector:{sender:'e.varkonyi@utteurope.com',subject:'Megrendelés visszaigazolása: 2026/8420/002'}, eventType:value('order_created'),merchant:NA,orderNumber:value('2026/8420/002'),total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:NA,products:NA },
  { id:'ipon-3091626', selector:{sender:'info@ipon.hu',subject:'iPon - Rendelés #3091626'}, eventType:value('order_created'),merchant:value('iPon Computer'),orderNumber:value('3091626'),total:value(257429),currency:value('HUF'),carrier:NA,trackingNumber:NA,paymentStatus:NA,products:NA },
  { id:'szidibox-SO-2024-27135', selector:{sender:'szidibox@gmail.com',subject:'Szidibox Karton Kft. Webáruház - Rendelés SO-2024-27135'}, eventType:value('order_created'),merchant:value('Szidibox Karton Kft. Webáruház'),orderNumber:value('SO-2024-27135'),total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:value('cash_on_delivery'),products:NA },
  { id:'jatektenger-26083-131173', selector:{sender:'webrendeles@jatektenger.hu',subject:'Játéktenger - Megrendelés státusz módosítás'}, eventType:value('shipment'),merchant:value('Játéktenger'),orderNumber:value('26083-131173'),total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:NA,products:NA },
  { id:'googleplay-2026-04-24', selector:{sender:'googleplay-noreply@google.com',subject:'Google Play-rendelés (2026. ápr. 24.) nyugtája'}, eventType:value('invoice_or_receipt'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:NA,products:NA },
  { id:'mcdonalds-2026-04-03', selector:{sender:'DoNotReply@mcdonalds.com',subject:'Fizetés megerősítése',contains:'03/04/26 12:04'}, eventType:value('payment_completed'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:value('paid'),products:NA },
];

export const FIELD_BLIND_NOISE_V1 = [
  { sender:'ugyfelszolgalat@dijnet.hu', subject:'Díjnet számla érkezett' },
  { sender:'info@fogyasztobarat.hu', subject:'Fogyasztó Barát - Kiegyenlítetlen számla 1. értesítő' },
  { sender:'info@fogyasztobarat.hu', subject:'Fogyasztó Barát - Kiegyenlítetlen számla 2. értesítő' },
  { sender:'info@fogyasztobarat.hu', subject:'Fogyasztó Barát - Számla' },
  { sender:'info@ipon.hu', subject:'Re: iPon - Rendelés #3091626' },
  { sender:'noreply@simplepay.hu', subject:'SimplePay - Sikeres fizetés - https://www.netfone.hu' },
] as const;

export const FIELD_BLIND_META_V1 = {
  version:'field-blind-holdout-v1', frozenBeforeFirstEngineRun:true, parserOutputUsedAsTruth:false,
  source:'gmail-human-selected-unseen-messages', policy:'no parser changes until first result is recorded',
} as const;
