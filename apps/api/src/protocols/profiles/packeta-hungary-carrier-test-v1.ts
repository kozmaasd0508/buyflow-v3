import type { ProtocolProfile } from '../types.js';

/**
 * Direct Packeta Hungary recipient-notification profile derived from repeated
 * sanitized real emails plus current Packeta/FOXPOST documentation.
 *
 * Hungary is in a transition state: Packeta Hungary Kft. merged into FoxPost
 * Kft. on 2026-01-01, while authenticated recipient mail continued to use
 * noreply@packeta.hu with packeta.hu DKIM. The profile therefore keys carrier
 * authority to the authenticated technical channel and explicit body semantics,
 * never the display name alone.
 */
export const PACKETA_HUNGARY_CARRIER_TEST_V1: ProtocolProfile = {
  protocol_id: 'carrier.hu.packeta',
  protocol_version: '1.0.0-test.1',
  kind: 'carrier',
  status: 'test',
  display_name: 'Packeta Hungary / FoxPost Kft.',
  country: 'HU',
  sender_domains: ['packeta.hu'],
  sender_addresses: ['noreply@packeta.hu'],
  identifier_patterns: {
    order_id: [],
    tracking_id: [
      'tracking\\.packeta\\.com[^\\s\\)]*[?&]id=(Z[0-9]{10})',
      '(Z\\s*[0-9]{3}\\s*[0-9]{4}\\s*[0-9]{3})',
    ],
    invoice_id: [],
    payment_reference: [],
  },
  sources: [
    {
      id: 'packeta-official-pickup-flow',
      title: 'Packeta Hungary - Csomagátvétel átvevőhelyen',
      url: 'https://www.packeta.hu/csomagatvetel',
      provenance: 'official_documentation',
      notes: 'Current Packeta documentation says the webshop hands the prepared parcel to the network, Packeta sends parcel/tracking information after processing, and a later notification with pickup code is sent once the parcel reaches the selected pickup point.',
    },
    {
      id: 'packeta-official-hu-merger',
      title: 'Packeta Hungary - Kézbesítés Magyarországon / 2026 transition',
      url: 'https://www.packeta.hu/hova-szallitunk/hu',
      provenance: 'official_documentation',
      notes: 'Packeta documents that Packeta Hungary Kft. merged into FoxPost Kft. on 2026-01-01 and FoxPost Kft. became its legal successor.',
    },
    {
      id: 'packeta-official-zbox-transition',
      title: 'Packeta Z-BOX to FOXPOST Z-BOX transition',
      url: 'https://www.packeta.hu/blog/packeta-z-box-atalakulas-foxpost-zbox/',
      provenance: 'official_documentation',
      notes: 'Packeta documents that Hungarian Packeta Z-BOX machines were progressively migrated into the FOXPOST network in 2026 and operate as FOXPOST Z-BOX after migration.',
    },
    {
      id: 'packeta-observed-accepted',
      title: 'Observed Packeta accepted-for-transport emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated recipient emails used subject A szállítmányt elfogadták a szállításra. Observed body variants explicitly said either that the sender had now sent the parcel or that the webshop had handed the parcel/order to Packeta for delivery to a Z-BOX, pickup point or onward contractual carrier.',
    },
    {
      id: 'packeta-observed-ready',
      title: 'Observed Packeta pickup-ready emails (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated recipient emails used subject A csomag készen áll átvételre and explicitly stated that the identified parcel was ready for pickup in a Z-BOX or at a named Packeta pickup point, with pickup code/password and collection deadline where applicable.',
    },
    {
      id: 'packeta-observed-ready-reminder',
      title: 'Observed Packeta still-waiting pickup reminder (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'An observed reminder used subject Megjegyzés: A szállítmány kézbesítésre kész and explicitly said the parcel was still waiting in the Z-BOX for recipient collection. This remains READY_FOR_PICKUP and is not delivery proof.',
    },
    {
      id: 'packeta-observed-payment-negative',
      title: 'Observed Packeta online COD payment confirmation (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Repeated Visszaigazolás az online kártyás fizetéshez messages confirmed COD payment but also stated that the parcel might still not be collected and could later be returned. Payment confirmation is therefore not parcel DELIVERED or RETURN evidence in this carrier phase.',
    },
    {
      id: 'packeta-observed-auth',
      title: 'Observed Packeta authenticated recipient mail infrastructure (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'Raw MIME from 2025 Packeta Hungary and 2026 FoxPost Kft. display-name variants verified exact noreply@packeta.hu, DKIM pass for packeta.hu, SPF pass and DMARC pass. mg.packeta.hu/Mailgun transport is not treated as the sole identity signal.',
    },
    {
      id: 'packeta-observed-cross-network',
      title: 'Observed Packeta to FOXPOST handoff journey (sanitized)',
      provenance: 'observed_real_email',
      observed_at: '2026-08-16',
      notes: 'A 2026 journey first produced authenticated noreply@packeta.hu acceptance from the same merchant, then a separate authenticated no-reply@foxpost.hu warehouse-arrival message with a different CLFOX identifier. The two carrier namespaces must not be collapsed by identifier guessing.',
    },
  ],
  events: [
    {
      event: 'SHIPPED',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'packeta.shipped.dkim',
          field: 'dkim_domain',
          pattern: '^packeta\\.hu$',
          required: true,
          source_ids: ['packeta-observed-auth'],
        },
        {
          id: 'packeta.shipped.subject',
          field: 'subject',
          pattern: '^A sz[aá]ll[ií]tm[aá]nyt elfogadt[aá]k a sz[aá]ll[ií]t[aá]sra$',
          required: true,
          source_ids: ['packeta-observed-accepted', 'packeta-official-pickup-flow'],
        },
        {
          id: 'packeta.shipped.explicit-handoff',
          field: 'body',
          pattern: '(?:felad[oó][\\s\\S]{0,100}?most adta fel az [ÖO]n csomagj[aá]t|Web[aá]ruh[aá]z[\\s\\S]{0,220}?[aá]tadta nek[uü]nk az [ÖO]n[\\s\\S]{0,120}?Z\\s*[0-9]{3}\\s*[0-9]{4}\\s*[0-9]{3})',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['packeta-observed-accepted', 'packeta-official-pickup-flow'],
        },
        {
          id: 'packeta.shipped.destination',
          field: 'body',
          pattern: '(?:Z-BOXba ker[uü]l k[eé]zbes[ií]t[eé]sre|v[aá]lasztott [aá]tvev[oő]helyre lesz k[eé]zbes[ií]tve|szerz[oő]d[eé]ses sz[aá]ll[ií]t[oó]partner[uü]nk fog k[eé]zbes[ií]teni)',
          required: true,
          source_ids: ['packeta-observed-accepted'],
        },
        {
          id: 'packeta.shipped.tracking',
          field: 'body',
          pattern: 'Z\\s*[0-9]{3}\\s*[0-9]{4}\\s*[0-9]{3}',
          required: true,
          source_ids: ['packeta-observed-accepted'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
    {
      event: 'READY_FOR_PICKUP',
      base_confidence: 0.99,
      positive_rules: [
        {
          id: 'packeta.ready.dkim',
          field: 'dkim_domain',
          pattern: '^packeta\\.hu$',
          required: true,
          source_ids: ['packeta-observed-auth'],
        },
        {
          id: 'packeta.ready.subject',
          field: 'subject',
          pattern: '^(?:A csomag k[eé]szen [aá]ll [aá]tv[eé]telre|Megjegyz[eé]s: A sz[aá]ll[ií]tm[aá]ny k[eé]zbes[ií]t[eé]sre k[eé]sz)$',
          required: true,
          source_ids: ['packeta-observed-ready', 'packeta-observed-ready-reminder', 'packeta-official-pickup-flow'],
        },
        {
          id: 'packeta.ready.explicit',
          field: 'body',
          pattern: '(?:csomagja k[eé]szen [aá]ll a Z-BOXban t[oö]rt[eé]n[oő] [aá]tv[eé]telre|csomagja[\\s\\S]{0,160}?[aá]tv[eé]telre k[eé]szen [aá]ll az al[aá]bbi [aá]tvev[oő]helyen|m[eé]g mindig a Z-BOXban v[aá]rja[\\s\\S]{0,40}?[ÖO]n [aá]tvegye)',
          required: true,
          confidence_delta: 0.01,
          source_ids: ['packeta-observed-ready', 'packeta-observed-ready-reminder', 'packeta-official-pickup-flow'],
        },
        {
          id: 'packeta.ready.tracking',
          field: 'body',
          pattern: 'Z\\s*[0-9]{3}\\s*[0-9]{4}\\s*[0-9]{3}',
          required: true,
          source_ids: ['packeta-observed-ready', 'packeta-observed-ready-reminder'],
        },
      ],
      prohibitions: [
        'DO_NOT_CREATE_PURCHASE',
        'DO_NOT_SET_SHIPPED_AT',
        'DO_NOT_MARK_DELIVERED',
      ],
    },
  ],
  notes: [
    'Direct authenticated noreply@packeta.hu evidence is treated as a Packeta carrier channel even when the 2026 display name is FoxPost Kft.; display-name branding alone is never an identity gate.',
    'A szállítmányt elfogadták a szállításra is SHIPPED only when the body explicitly states sender/webshop handoff and the destination flow. Subject alone is insufficient.',
    'A csomag készen áll átvételre is READY_FOR_PICKUP for both Z-BOX and staffed Packeta pickup-point variants. It never means DELIVERED.',
    'Megjegyzés: A szállítmány kézbesítésre kész is also READY_FOR_PICKUP only when the body says the parcel is still waiting in the Z-BOX for collection. The Hungarian word kézbesítés in this reminder must not become DELIVERED.',
    'Online COD payment confirmation is deliberately not mapped in this carrier profile. Payment can succeed while the parcel remains uncollected and can still be returned later.',
    'No DELIVERED rule is enabled because no separate authenticated recipient email proving actual Packeta pickup was found in the researched mailbox.',
    'No RETURN rule is enabled because observed text about return after non-collection is conditional future wording, not evidence that a return has actually started.',
    'No OUT_FOR_DELIVERY rule is enabled for Packeta home-delivery handoffs because the observed Packeta acceptance mail says a contractual carrier will perform delivery. Direct downstream carrier evidence should own later physical states.',
    'A 2026 Packeta-to-FOXPOST journey showed different Packeta Z and FOXPOST CLFOX identifiers. BuyFlow must not fabricate an identifier equivalence between those namespaces.',
    'The profile is test/shadow only and cannot create a Purchase or write live lifecycle state.',
  ],
};