export type PurchasePulseTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger';

export interface PurchasePulseShipmentInput {
  status: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  lastEventAt?: string | null;
}

export interface PurchasePulseInput {
  currentState: string | null;
  orderedAt?: string | null;
  paidAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  createdAt?: string | null;
  shipments?: PurchasePulseShipmentInput[];
}

export interface PurchasePulseView {
  status: string;
  label: string;
  title: string;
  body: string;
  tone: PurchasePulseTone;
  movement: boolean;
  delivered: boolean;
  reviewRequired: boolean;
  lastConfirmedAt: string | null;
}

const MOVEMENT_STATES = new Set(['shipped', 'in_transit', 'out_for_delivery', 'ready_for_pickup']);
const TERMINAL_STATES = new Set(['cancelled', 'refunded', 'returned']);

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : null;
}

function latest(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .map(validTimestamp)
    .filter((value): value is string => Boolean(value));
  if (timestamps.length === 0) return null;
  return timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function shipmentActivity(shipments: PurchasePulseShipmentInput[]): string | null {
  return latest(shipments.flatMap((shipment) => [shipment.lastEventAt, shipment.deliveredAt, shipment.shippedAt]));
}

function baseActivity(input: PurchasePulseInput, shipments: PurchasePulseShipmentInput[]): string | null {
  return latest([
    shipmentActivity(shipments),
    input.deliveredAt,
    input.shippedAt,
    input.paidAt,
    input.orderedAt,
    input.createdAt,
  ]);
}

function view(
  status: string,
  label: string,
  title: string,
  body: string,
  tone: PurchasePulseTone,
  lastConfirmedAt: string | null,
  options: Partial<Pick<PurchasePulseView, 'movement' | 'delivered' | 'reviewRequired'>> = {},
): PurchasePulseView {
  return {
    status,
    label,
    title,
    body,
    tone,
    movement: options.movement ?? false,
    delivered: options.delivered ?? false,
    reviewRequired: options.reviewRequired ?? false,
    lastConfirmedAt,
  };
}

export function derivePurchasePulse(input: PurchasePulseInput): PurchasePulseView {
  const state = normalize(input.currentState);
  const shipments = input.shipments ?? [];
  const shipmentStates = shipments.map((shipment) => normalize(shipment.status));
  const activity = baseActivity(input, shipments);

  // Ambiguous identity/state always wins over optimistic timestamps or shipment hints.
  if (state === 'review' || state === 'pending') {
    return view(
      state,
      state === 'review' ? 'Ellenőrzés alatt' : 'Függőben',
      'A BuyFlow még ellenőrzi',
      'Az állapot még nem elég biztos ahhoz, hogy fizetést, feladást vagy kézbesítést kész tényként mutassunk.',
      'warning',
      activity,
      { reviewRequired: true },
    );
  }

  if (TERMINAL_STATES.has(state)) {
    if (state === 'cancelled') {
      return view('cancelled', 'Törölve', 'A rendelés törölve lett', 'A vásárlás törölt életútként van lezárva.', 'danger', latest([input.cancelledAt, activity]));
    }
    if (state === 'refunded') {
      return view('refunded', 'Visszatérítve', 'Visszatérítés rögzítve', 'A vásárlás visszatérített állapotban van.', 'success', activity);
    }
    return view('returned', 'Visszaküldve', 'Visszaküldés rögzítve', 'A vásárlás visszaküldött állapotban van.', 'warning', activity);
  }

  const allShipmentsDelivered = shipments.length > 0 && shipmentStates.every((status) => status === 'delivered');
  const hasUndeliveredShipment = shipments.length > 0 && shipmentStates.some((status) => status !== 'delivered');

  // JourneyGraph authority: a whole Purchase cannot be presented as delivered while any linked parcel is not delivered.
  if (state === 'delivered' && hasUndeliveredShipment) {
    return view(
      'review',
      'Ellenőrzés alatt',
      'A kézbesítés állapota még nem egységes',
      'Legalább egy kapcsolt csomag még nincs kézbesítve, ezért a teljes rendelést nem jelöljük megérkezettnek.',
      'warning',
      activity,
      { reviewRequired: true },
    );
  }

  if (state === 'delivered') {
    return view(
      'delivered',
      'Kézbesítve',
      'A rendelés megérkezett',
      'A teljes vásárlás kézbesített állapotban van.',
      'success',
      latest([
        ...shipments.map((shipment) => shipment.deliveredAt),
        input.deliveredAt,
        activity,
      ]),
      { delivered: true },
    );
  }

  // If every parcel says delivered but Core/JourneyGraph has not committed the aggregate state yet,
  // fail closed instead of claiming whole-Purchase delivery from child rows alone.
  if (allShipmentsDelivered) {
    return view(
      'review',
      'Ellenőrzés alatt',
      'A kézbesítési adatok egyeztetése folyik',
      'A csomagok kézbesítettnek látszanak, de a teljes rendelés végső állapota még nincs megerősítve.',
      'warning',
      activity,
      { reviewRequired: true },
    );
  }

  const hasReadyForPickup = state === 'ready_for_pickup' || shipmentStates.includes('ready_for_pickup');
  if (hasReadyForPickup) {
    return view(
      'ready_for_pickup',
      'Átvehető',
      shipments.length > 1 ? 'Legalább egy csomag átvehető' : 'A csomag átvehető',
      'Van igazolt átvételi állapot. A többi kapcsolt csomagot külön is figyelembe vesszük.',
      'active',
      activity,
      { movement: true },
    );
  }

  const hasOutForDelivery = state === 'out_for_delivery' || shipmentStates.includes('out_for_delivery');
  if (hasOutForDelivery) {
    return view(
      'out_for_delivery',
      'Kézbesítés alatt',
      shipments.length > 1 ? 'Legalább egy csomag kézbesítés alatt van' : 'A csomag kézbesítés alatt van',
      'A futár kézbesítési eseményt jelzett. Pontos érkezési ígéretet csak biztos adatból mutatunk.',
      'active',
      activity,
      { movement: true },
    );
  }

  const hasTransit = MOVEMENT_STATES.has(state) || shipmentStates.some((status) => status === 'shipped' || status === 'in_transit');
  if (hasTransit) {
    return view(
      state === 'shipped' ? 'shipped' : 'in_transit',
      'Úton van',
      shipments.length > 1 ? 'A rendelés csomagjai mozgásban vannak' : 'A csomag úton van',
      'Biztos szállítási esemény van, de a teljes rendelést csak minden kapcsolt csomag alapján zárjuk le.',
      'active',
      activity,
      { movement: true },
    );
  }

  if (state === 'delayed') {
    return view('delayed', 'Késik', 'Késés rögzítve', 'A rendelésnél késési állapot van rögzítve.', 'warning', activity);
  }

  if (state === 'payment_failed') {
    return view('payment_failed', 'Fizetési hiba', 'A fizetés nem igazolt', 'A fizetés sikere nincs megerősítve; újabb biztos eseményre várunk.', 'warning', activity);
  }

  if (state === 'paid') {
    return view('paid', 'Fizetve', 'Fizetés rendben', 'A fizetett állapot biztos. Most a feladási vagy futáradatot várjuk.', 'active', latest([input.paidAt, input.orderedAt, input.createdAt]));
  }

  if (state === 'processing') {
    return view('processing', 'Feldolgozás alatt', 'A rendelést feldolgozzák', 'A rendelés rögzítve van, de még nincs biztos szállítási esemény.', 'active', latest([input.orderedAt, input.createdAt]));
  }

  if (state === 'ordered') {
    return view('ordered', 'Megrendelve', 'A rendelés rögzítve van', 'A következő biztos fizetési vagy szállítási eseményre várunk.', 'neutral', latest([input.orderedAt, input.createdAt]));
  }

  return view(
    state || 'unknown',
    'Ellenőrzés alatt',
    'Az aktuális állapot még nem biztos',
    'A BuyFlow nem mutat optimista státuszt addig, amíg nincs hozzá egyértelmű, megerősített állapot.',
    'warning',
    activity,
    { reviewRequired: true },
  );
}
