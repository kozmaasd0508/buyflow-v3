import type { ProtocolProfile } from './types.js';
import { assertValidProtocolProfile } from './profile-validator.js';
import { BARION_PAYMENT_TEST_V1 } from './profiles/barion-payment-test-v1.js';
import { BILLINGO_INVOICE_TEST_V1, BILLINGO_PROFORMA_TEST_V1 } from './profiles/billingo-invoicing-test-v1.js';
import { DPD_HUNGARY_CARRIER_TEST_V1 } from './profiles/dpd-hungary-carrier-test-v1.js';
import { EXPRESSONE_CARRIER_TEST_V1 } from './profiles/expressone-carrier-test-v1.js';
import { FORPROSHOP_SHOPRENTER_TEST_V1 } from './profiles/forproshop-shoprenter-test-v1.js';
import { FOXPOST_CARRIER_TEST_V1 } from './profiles/foxpost-carrier-test-v1.js';
import { GLS_HUNGARY_CARRIER_TEST_V1 } from './profiles/gls-hungary-carrier-test-v1.js';
import { GYEREKJATEKBOLT_SHOPRENTER_TEST_V1 } from './profiles/gyerekjatekbolt-shoprenter-test-v1.js';
import { HOMEAUTOMATICA_SHOPRENTER_TEST_V1 } from './profiles/homeautomatica-shoprenter-test-v1.js';
import { MPL_CARRIER_TEST_V1 } from './profiles/mpl-carrier-test-v1.js';
import { PACKETA_HUNGARY_CARRIER_TEST_V1 } from './profiles/packeta-hungary-carrier-test-v1.js';
import { PAYPAL_PAYMENT_TEST_V1 } from './profiles/paypal-payment-test-v1.js';
import { SHOPIFY_TEST_V1 } from './profiles/shopify-test-v1.js';
import { SHOPRENTER_TEST_V1 } from './profiles/shoprenter-test-v1.js';
import { SIMPLEPAY_PAYMENT_TEST_V1 } from './profiles/simplepay-payment-test-v1.js';
import { STRIPE_PAYMENT_TEST_V1 } from './profiles/stripe-payment-test-v1.js';
import {
  SZAMLAZZHU_INVOICE_TEST_V1,
  SZAMLAZZHU_PAYMENT_REMINDER_TEST_V1,
  SZAMLAZZHU_STORNO_TEST_V1,
} from './profiles/szamlazzhu-invoicing-test-v1.js';
import { UNAS_TEST_V1 } from './profiles/unas-test-v1.js';
import { WEBARENA_SHOPRENTER_TEST_V1 } from './profiles/webarena-shoprenter-test-v1.js';
import { WOOCOMMERCE_TEST_V1 } from './profiles/woocommerce-test-v1.js';

/**
 * Test/shadow registry.
 *
 * Profiles listed here are deliberately isolated from registry.ts, which is
 * the production registry. This makes it possible to measure candidate rules
 * without changing live BuyFlow recognition or writes.
 */
const TEST_PROTOCOL_PROFILES: ProtocolProfile[] = [
  WOOCOMMERCE_TEST_V1,
  SHOPIFY_TEST_V1,
  UNAS_TEST_V1,
  SHOPRENTER_TEST_V1,
  GYEREKJATEKBOLT_SHOPRENTER_TEST_V1,
  HOMEAUTOMATICA_SHOPRENTER_TEST_V1,
  WEBARENA_SHOPRENTER_TEST_V1,
  FORPROSHOP_SHOPRENTER_TEST_V1,
  FOXPOST_CARRIER_TEST_V1,
  GLS_HUNGARY_CARRIER_TEST_V1,
  MPL_CARRIER_TEST_V1,
  EXPRESSONE_CARRIER_TEST_V1,
  DPD_HUNGARY_CARRIER_TEST_V1,
  PACKETA_HUNGARY_CARRIER_TEST_V1,
  SIMPLEPAY_PAYMENT_TEST_V1,
  BARION_PAYMENT_TEST_V1,
  STRIPE_PAYMENT_TEST_V1,
  PAYPAL_PAYMENT_TEST_V1,
  BILLINGO_INVOICE_TEST_V1,
  BILLINGO_PROFORMA_TEST_V1,
  SZAMLAZZHU_INVOICE_TEST_V1,
  SZAMLAZZHU_STORNO_TEST_V1,
  SZAMLAZZHU_PAYMENT_REMINDER_TEST_V1,
];

for (const profile of TEST_PROTOCOL_PROFILES) {
  assertValidProtocolProfile(profile);
}

export function registeredTestProtocolProfiles(): readonly ProtocolProfile[] {
  return TEST_PROTOCOL_PROFILES;
}
