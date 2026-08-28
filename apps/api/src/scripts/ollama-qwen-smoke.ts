import { extractEmailWithOllamaResult } from '../ai/ollama-email-extractor.js';

const model = process.env.OLLAMA_MODEL ?? 'qwen3:30b';
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

const cases = [
  {
    name: 'merchant-order',
    subject: 'Rendelésedet megkaptuk – #12345',
    fromDomains: ['service.gymbeam.hu'],
    bodyText: [
      'Köszönjük a rendelésed!',
      'Rendelésszám: #12345',
      'Termék: 100% Whey Protein, 1 db, 12 990 Ft',
      'Szállítás: 2 000 Ft',
      'Fizetendő összesen: 14 990 Ft',
      'Fizetési mód: utánvét',
    ].join('\n'),
    expectedEvent: 'order_created',
    expectedOrder: '12345',
  },
  {
    name: 'carrier-delivery',
    subject: 'Csomagod kézbesítettük – ABC987654',
    fromDomains: ['expressone.hu'],
    bodyText: [
      'A küldeményt sikeresen kézbesítettük.',
      'Nyomkövetési azonosító: ABC987654',
      'Feladó: GymBeam',
    ].join('\n'),
    expectedEvent: 'delivery',
    expectedTracking: 'ABC987654',
  },
] as const;

console.log(`BUYFLOW_LOCAL_AI_SMOKE model=${model} baseUrl=${baseUrl}`);

let failed = 0;
for (const item of cases) {
  try {
    const result = await extractEmailWithOllamaResult({
      model,
      baseUrl,
      subject: item.subject,
      fromDomains: [...item.fromDomains],
      bodyText: item.bodyText,
    });

    const eventOk = result.extraction.event_type === item.expectedEvent;
    const orderOk = !('expectedOrder' in item) || result.extraction.order_number === item.expectedOrder;
    const trackingOk =
      !('expectedTracking' in item) || result.extraction.tracking_number === item.expectedTracking;
    const ok = eventOk && orderOk && trackingOk;
    if (!ok) failed += 1;

    console.log(JSON.stringify({
      case: item.name,
      ok,
      eventType: result.extraction.event_type,
      orderNumber: result.extraction.order_number,
      trackingNumber: result.extraction.tracking_number,
      merchant: result.extraction.merchant,
      carrier: result.extraction.carrier,
      parcelSender: result.extraction.parcel_sender,
      total: result.extraction.total,
      currency: result.extraction.currency,
      confidence: result.extraction.confidence,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      totalDurationMs: result.totalDurationMs,
    }));
  } catch (error) {
    failed += 1;
    console.error(JSON.stringify({
      case: item.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

if (failed > 0) {
  console.error(`BUYFLOW_LOCAL_AI_SMOKE_FAIL failures=${failed}/${cases.length}`);
  process.exitCode = 1;
} else {
  console.log(`BUYFLOW_LOCAL_AI_SMOKE_PASS cases=${cases.length}/${cases.length}`);
}
