import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NormalizedEmail } from '../email/types.js';
import { EVENTMIND_EVENT_TYPES, type EventMindEventType } from '../ai/eventmind-v1.js';

const PHRASES: Record<EventMindEventType, string[]> = {
  ORDER_CREATED: [
    'A rendelésedet sikeresen rögzítettük és visszaigazoltuk.',
    'Your order has been received and confirmed.',
    'Deine Bestellung wurde erfolgreich bestätigt.',
    'Twoje zamówienie zostało przyjęte i potwierdzone.',
    'Votre commande a bien été reçue et confirmée.',
  ],
  ORDER_PROCESSING: [
    'A rendelésed feldolgozása folyamatban van.',
    'We are currently processing your order.',
    'Deine Bestellung wird derzeit bearbeitet.',
    'Twoje zamówienie jest obecnie przetwarzane.',
    'Votre commande est en cours de traitement.',
  ],
  ORDER_PACKING: [
    'A rendelésedet most csomagoljuk össze.',
    'Your order is being packed now.',
    'Deine Bestellung wird gerade verpackt.',
    'Twoje zamówienie jest teraz pakowane.',
    'Votre commande est en cours de préparation et emballage.',
  ],
  SHIPMENT_CREATED: [
    'A csomag adatai elkészültek, a futár még nem vette át.',
    'A shipment has been created; the carrier has not collected it yet.',
    'Die Sendung wurde angekündigt, aber noch nicht vom Paketdienst übernommen.',
    'Przesyłka została utworzona, ale kurier jeszcze jej nie odebrał.',
    'L’expédition a été créée, mais le transporteur ne l’a pas encore prise en charge.',
  ],
  SHIPPED: [
    'A csomagot átadtuk a futárszolgálatnak.',
    'Your parcel has been handed over to the carrier.',
    'Dein Paket wurde an den Versanddienstleister übergeben.',
    'Paczka została przekazana kurierowi.',
    'Votre colis a été remis au transporteur.',
  ],
  IN_TRANSIT: [
    'A csomagod úton van a hálózatban.',
    'Your parcel is currently in transit.',
    'Dein Paket befindet sich auf dem Transportweg.',
    'Twoja paczka jest w drodze.',
    'Votre colis est actuellement en transit.',
  ],
  OUT_FOR_DELIVERY: [
    'A csomagod ma kézbesítésre került a futárhoz.',
    'Your parcel is out for delivery today.',
    'Dein Paket ist heute in Zustellung.',
    'Twoja paczka jest dziś w doręczeniu.',
    'Votre colis est en cours de livraison aujourd’hui.',
  ],
  READY_FOR_PICKUP: [
    'A csomagod átvehető a kiválasztott automatában.',
    'Your parcel is ready for pickup.',
    'Dein Paket liegt zur Abholung bereit.',
    'Twoja paczka jest gotowa do odbioru.',
    'Votre colis est prêt à être retiré.',
  ],
  DELIVERED: [
    'A csomagot sikeresen kézbesítettük.',
    'Your parcel has been delivered successfully.',
    'Dein Paket wurde erfolgreich zugestellt.',
    'Twoja paczka została doręczona.',
    'Votre colis a bien été livré.',
  ],
  DELIVERY_FAILED: [
    'A mai kézbesítési kísérlet sikertelen volt.',
    'The delivery attempt was unsuccessful.',
    'Der Zustellversuch war nicht erfolgreich.',
    'Próba doręczenia nie powiodła się.',
    'La tentative de livraison a échoué.',
  ],
  DELAYED: [
    'A küldemény kézbesítése késik.',
    'Your shipment has been delayed.',
    'Die Zustellung deiner Sendung verzögert sich.',
    'Doręczenie przesyłki jest opóźnione.',
    'La livraison de votre envoi est retardée.',
  ],
  CANCELLED: [
    'A rendelést töröltük, további teljesítés nem történik.',
    'Your order has been cancelled.',
    'Deine Bestellung wurde storniert.',
    'Twoje zamówienie zostało anulowane.',
    'Votre commande a été annulée.',
  ],
  REFUNDED: [
    'A visszatérítést elindítottuk és az összeget jóváírtuk.',
    'Your refund has been completed.',
    'Deine Rückerstattung wurde abgeschlossen.',
    'Zwrot środków został zrealizowany.',
    'Votre remboursement a été effectué.',
  ],
  PAYMENT: [
    'A fizetés sikeresen megtörtént.',
    'Your payment was successful.',
    'Deine Zahlung war erfolgreich.',
    'Płatność zakończyła się powodzeniem.',
    'Votre paiement a été accepté.',
  ],
  INVOICE: [
    'Kiállítottuk a számlát ehhez a vásárláshoz.',
    'Your invoice has been issued.',
    'Deine Rechnung wurde erstellt.',
    'Faktura została wystawiona.',
    'Votre facture a été émise.',
  ],
  RETURN: [
    'A visszaküldési folyamatot rögzítettük, várjuk a terméket.',
    'Your return request has been registered.',
    'Deine Rücksendung wurde angemeldet.',
    'Zgłoszenie zwrotu zostało zarejestrowane.',
    'Votre demande de retour a été enregistrée.',
  ],
  WARRANTY: [
    'A garanciális ügyet rögzítettük és vizsgáljuk.',
    'Your warranty claim has been registered.',
    'Dein Garantiefall wurde aufgenommen.',
    'Zgłoszenie gwarancyjne zostało zarejestrowane.',
    'Votre demande de garantie a été enregistrée.',
  ],
  OTHER: [
    'Nézd meg a hétvégi kedvezményeinket és újdonságainkat.',
    'Discover this week’s offers and new arrivals.',
    'Entdecke unsere aktuellen Angebote und Neuheiten.',
    'Sprawdź najnowsze promocje i nowości.',
    'Découvrez nos promotions et nouveautés de la semaine.',
  ],
};

const OLD_STATE: Partial<Record<EventMindEventType, string>> = {
  ORDER_PROCESSING: 'Old quoted state: order confirmed.',
  ORDER_PACKING: 'Old quoted state: order processing.',
  SHIPMENT_CREATED: 'Old quoted state: order packed.',
  SHIPPED: 'Old quoted state: shipment created.',
  IN_TRANSIT: 'Old quoted state: parcel handed to carrier.',
  OUT_FOR_DELIVERY: 'Old quoted state: parcel in transit.',
  READY_FOR_PICKUP: 'Old quoted state: parcel in transit.',
  DELIVERED: 'Old quoted state: out for delivery.',
  DELIVERY_FAILED: 'Old quoted state: out for delivery.',
  DELAYED: 'Old quoted state: parcel in transit.',
  CANCELLED: 'Old quoted state: order processing.',
  REFUNDED: 'Old quoted state: return registered.',
  INVOICE: 'Old quoted state: payment successful.',
  RETURN: 'Old quoted state: delivered.',
  WARRANTY: 'Old quoted state: delivered.',
};

function subject(eventType: EventMindEventType, index: number): string {
  if (eventType === 'OTHER') return index % 2 === 0 ? 'Újdonságok neked' : 'Weekly newsletter';
  if (index % 2 === 0 && ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED'].includes(eventType)) {
    return 'Your order has been confirmed';
  }
  if (index % 2 === 1 && ['CANCELLED', 'REFUNDED', 'RETURN'].includes(eventType)) {
    return 'Order update';
  }
  return 'Purchase status update';
}

function sourceEmail(eventType: EventMindEventType, index: number, phrase: string): NormalizedEmail {
  const commerce = eventType !== 'OTHER';
  const identitySuffix = `${String(EVENTMIND_EVENT_TYPES.indexOf(eventType) + 1).padStart(2, '0')}${index + 1}`;
  const quoted = OLD_STATE[eventType];
  const bodyText = quoted
    ? `${phrase}\nReference: ORDER-NEW-${identitySuffix}.\n----- Original Message -----\n${quoted}\nOld tracking TRACK-OLD-${identitySuffix}.`
    : `${phrase}${commerce ? `\nReference: ORDER-NEW-${identitySuffix}.` : ''}`;
  const structured = commerce
    ? `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': eventType.includes('SHIP') || ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED', 'DELIVERY_FAILED', 'DELAYED'].includes(eventType)
          ? 'ParcelDelivery'
          : 'Order',
        orderNumber: `ORDER-NEW-${identitySuffix}`,
        trackingNumber: `TRACK-NEW-${identitySuffix}`,
        lifecycleStatus: eventType,
        url: `https://example.test/orders/ORDER-NEW-${identitySuffix}`,
      })}</script><p>${phrase}</p>`
    : `<p>${phrase}</p>`;

  return {
    provider: 'gmail',
    providerMessageId: `untouched-v1-${eventType.toLowerCase()}-${index + 1}`,
    subject: subject(eventType, index),
    from: [{
      email: commerce ? 'transactional@fresh-holdout.example' : 'newsletter@fresh-holdout.example',
      name: commerce ? 'Fresh Holdout Shop' : 'Fresh Holdout News',
    }],
    to: [{ email: 'buyer@example.test' }],
    cc: [],
    bcc: [],
    receivedAt: `2026-09-02T${String(14 + (index % 5)).padStart(2, '0')}:00:00.000Z`,
    snippet: index % 2 === 0 && commerce ? 'STALE SNIPPET: delivered' : phrase.slice(0, 80),
    bodyText,
    bodyHtml: structured,
    headers: [],
    folders: commerce ? ['CATEGORY_PURCHASES', 'INBOX'] : ['CATEGORY_PROMOTIONS', 'INBOX'],
    attachments: [],
  };
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const output = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(repoRoot, 'local-data', 'eventmind-v11-representation-gate', 'untouched-v1.jsonl');
  await mkdir(dirname(output), { recursive: true });

  try {
    await access(output);
    console.log(`Fixture already exists and was not overwritten: ${output}`);
    return;
  } catch {
    // First creation only.
  }

  const rows: string[] = [];
  for (const eventType of EVENTMIND_EVENT_TYPES) {
    const phrases = PHRASES[eventType];
    for (const [index, phrase] of phrases.entries()) {
      rows.push(JSON.stringify({
        case_id: `untouched-v1-${eventType.toLowerCase()}-${index + 1}`,
        email: sourceEmail(eventType, index, phrase),
        expected: {
          is_commerce: eventType !== 'OTHER',
          event_type: eventType,
        },
      }));
    }
  }
  await writeFile(output, rows.join('\n') + '\n', { encoding: 'utf-8', flag: 'wx' });
  console.log(`Created untouched EventMind fixture: ${output}`);
  console.log(`Cases: ${rows.length}`);
  console.log('Do not train on this fixture after it is evaluated.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
