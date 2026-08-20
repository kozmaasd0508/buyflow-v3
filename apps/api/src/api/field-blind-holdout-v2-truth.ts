import type { GroundTruthExpectation } from './field-ground-truth-v1.js';

export interface BlindV2Truth {
  messageId: string;
  eventType: GroundTruthExpectation<string>; merchant: GroundTruthExpectation<string>; orderNumber: GroundTruthExpectation<string>;
  total: GroundTruthExpectation<number>; currency: GroundTruthExpectation<string>; carrier: GroundTruthExpectation<string>;
  trackingNumber: GroundTruthExpectation<string>; paymentStatus: GroundTruthExpectation<string>;
  products: GroundTruthExpectation<Array<{name:string;quantity?:number}>>;
}
const NA={state:'not_asserted'} as const; const v=<T>(value:T):GroundTruthExpectation<T>=>({state:'value',value});
export const BLIND_V2_COMMERCE: BlindV2Truth[]=[
 {messageId:'19feb646e0160ca7',eventType:v('shipment'),merchant:v('FNP Products'),orderNumber:v('46789'),total:v(9560),currency:v('HUF'),carrier:v('Express One'),trackingNumber:NA,paymentStatus:v('cash_on_delivery'),products:v([{name:'Hidrolizált Kollagén Italpor Hialuronsavval MANGO ízben',quantity:1}])},
 {messageId:'19feaf982b637504',eventType:v('invoice_or_receipt'),merchant:v('GymBeam'),orderNumber:v('3010354660'),total:NA,currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:v('paid'),products:NA},
 {messageId:'19fd5e309b403641',eventType:v('delivery'),merchant:NA,orderNumber:NA,total:NA,currency:NA,carrier:v('DPD'),trackingNumber:v('13169408547018'),paymentStatus:NA,products:NA},
 {messageId:'19fce434814a5ebf',eventType:v('payment_completed'),merchant:v('Díjnet'),orderNumber:NA,total:v(14705),currency:v('HUF'),carrier:NA,trackingNumber:NA,paymentStatus:v('paid'),products:NA},
 {messageId:'19fcc8874f657138',eventType:v('payment_completed'),merchant:v('Gyerekjatekbolt.com'),orderNumber:v('536066'),total:v(14960),currency:NA,carrier:NA,trackingNumber:NA,paymentStatus:v('paid'),products:NA},
 {messageId:'19fc7bb6c2fcb815',eventType:v('shipment'),merchant:v('MODELL&HOBBY Kft.'),orderNumber:NA,total:NA,currency:NA,carrier:v('DPD'),trackingNumber:v('16380124260338'),paymentStatus:NA,products:NA},
];
export const BLIND_V2_NOISE=['1a01e5a22617a76d','1a01b363800e92d0','1a0123667ed47ccf','1a009fd96cc7eb43','19ffa16e809a4a47','19ff28a9a5531c8a','19fdb8a6f954adb4','19fd1ff082a80067','19fce5cf24baf31e','19fca841993ae749'] as const;
