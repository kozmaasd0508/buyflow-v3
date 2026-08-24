import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT,
  BLIND_HOLDOUT_V3_SELECTION_CUTOFF,
  blindHoldoutV3CaseId,
  freezeBlindHoldoutV3Truth,
} from '../extraction-v2/blind-holdout-v3-annotation.js';
import { BLIND_HOLDOUT_V3_FIELDS } from '../extraction-v2/blind-holdout-v3.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const MAX_SCAN = 2_000;
const BODY_MAX_CHARS = 80_000;

async function resolveUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function candidateLimit(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return 20;
  return Math.max(1, Math.min(100, Number(value)));
}

function bodyText(message: NormalizedEmail): { text: string; source: 'html_compacted' | 'snippet' } {
  if (message.bodyHtml) {
    return {
      text: htmlToCompactText(message.bodyHtml, BODY_MAX_CHARS),
      source: 'html_compacted',
    };
  }
  return {
    text: (message.snippet ?? '').slice(0, BODY_MAX_CHARS),
    source: 'snippet',
  };
}

function candidateForUser(userId: string, message: NormalizedEmail) {
  const body = bodyText(message);
  return {
    caseId: blindHoldoutV3CaseId(userId, message.providerMessageId),
    receivedAt: message.receivedAt,
    sender: {
      name: message.from[0]?.name ?? null,
      address: message.from[0]?.email ?? null,
    },
    subject: message.subject ?? '',
    bodyText: body.text,
    bodySource: body.source,
    attachments: message.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size ?? null,
    })),
  };
}

function pageReachedCutoffBoundary(messages: NormalizedEmail[], cutoffMs: number): boolean {
  const timestamps = messages
    .map((message) => Date.parse(message.receivedAt))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return false;

  const newestFirst = timestamps.every((value, index) => (
    index === 0 || timestamps[index - 1]! >= value
  ));
  return newestFirst && timestamps.some((value) => value <= cutoffMs);
}

async function loadCandidates(userId: string, limit: number) {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error } = await db
    .from('email_connections')
    .select('provider_account_id')
    .eq('user_id', userId)
    .eq('provider', 'nylas')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error('email_connection_lookup_failed');
  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: connection.provider_account_id,
  });

  const cutoffMs = Date.parse(BLIND_HOLDOUT_V3_SELECTION_CUTOFF);
  const matches: NormalizedEmail[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  let reachedCutoffBoundary = false;

  do {
    const page = await provider.searchMessages({
      query: '-in:spam -in:trash',
      limit: Math.min(100, MAX_SCAN - scanned),
      ...(cursor ? { cursor } : {}),
    });
    if (page.messages.length === 0) break;

    for (const message of page.messages) {
      const receivedMs = Date.parse(message.receivedAt);
      if (Number.isFinite(receivedMs) && receivedMs > cutoffMs) matches.push(message);
    }

    scanned += page.messages.length;
    reachedCutoffBoundary = pageReachedCutoffBoundary(page.messages, cutoffMs);
    cursor = reachedCutoffBoundary ? undefined : page.nextCursor;
  } while (cursor && scanned < MAX_SCAN);

  if (!reachedCutoffBoundary && cursor && scanned >= MAX_SCAN) {
    throw new Error('blind_v3_candidate_scan_truncated');
  }

  const candidates = matches
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .slice(0, limit)
    .map((message) => candidateForUser(userId, message));

  return {
    candidates,
    availablePostFreeze: matches.length,
    scanned,
    reachedCutoffBoundary,
  };
}

function pageHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blind Holdout v3 Ground Truth</title>
<style>
body{font-family:system-ui;background:#071020;color:#fff;max-width:1280px;margin:auto;padding:24px}.c{background:#0d1830;padding:18px;border-radius:16px;margin:14px 0}.muted{color:#9fb0c9}.bad{color:#ff9b9b}.good{color:#8ef0ba}button,select,input,textarea{font:inherit;border-radius:8px;border:1px solid #344665;padding:8px;background:#111e37;color:#fff}button{background:#7c4dff;border:0;font-weight:700;cursor:pointer}button.secondary{background:#263551}button:disabled{opacity:.45;cursor:not-allowed}.candidate{border:1px solid #263551;border-radius:12px;padding:14px;margin:16px 0}.meta{font-size:13px;color:#aebbd0}.mail{white-space:pre-wrap;max-height:280px;overflow:auto;background:#071020;padding:12px;border-radius:8px;margin:8px 0}.field{display:grid;grid-template-columns:170px 180px 1fr;gap:8px;align-items:start;margin:7px 0}.field label{padding-top:9px}.known{width:100%;box-sizing:border-box}textarea.known{min-height:70px}code{word-break:break-all}.sticky{position:sticky;top:0;z-index:5}#frozen{width:100%;min-height:220px}.warn{border-left:4px solid #ffcf66}.progress{font-weight:700}
</style>
<div class="c sticky">
  <b>BLIND HOLDOUT v3 · GROUND TRUTH ANNOTATION · ENGINE HIDDEN · 0 WRITE · 0 AI</b>
  <h1>Field Ground Truth v3</h1>
  <p class="muted">Csak a freeze után érkezett eredeti leveleket látod. Ezen az oldalon nincs v2/legacy prediction, evidence vagy parser output.</p>
  <p>Candidate freeze: <code>${BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT}</code><br>Selection cutoff: <code>${BLIND_HOLDOUT_V3_SELECTION_CUTOFF}</code></p>
  <select id="limit"><option>10</option><option selected>20</option><option>50</option><option>100</option></select>
  <button id="load" type="button">Post-freeze levelek betöltése</button>
  <span id="status"> UI indítása…</span>
  <p class="progress" id="progress"></p>
</div>
<div class="c warn"><b>Vakteszt szabály</b><p>A levelet előbb kézzel annotáld. A motor eredményét csak a GT JSON + SHA-256 lezárása és repository-freeze után szabad futtatni. A raw levélszöveg nem kerül a GT JSON-ba.</p></div>
<div id="list"></div>
<div class="c"><button id="freeze" type="button" disabled>GT csomag lezárása</button> <span id="freezeStatus"></span><p id="hash"></p><textarea id="frozen" readonly placeholder="A canonical GT JSON itt jelenik meg."></textarea></div>
<script src="/audit-blind-v3-annotate.js" defer></script>`;
}

function clientScript() {
  const fields = JSON.stringify(BLIND_HOLDOUT_V3_FIELDS);
  const cutoff = JSON.stringify(BLIND_HOLDOUT_V3_SELECTION_CUTOFF);
  const freezeCommit = JSON.stringify(BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT);
  return `(() => {
  "use strict";
  const FIELDS = ${fields};
  const CUTOFF = ${cutoff};
  const FREEZE_COMMIT = ${freezeCommit};
  const EVENT_TYPES = ["order_created","shipment","delivery","invoice_or_receipt","payment_completed","refund","return","cancellation"];
  const PAYMENT_STATUSES = ["paid","cash_on_delivery","failed","refunded"];
  const byId = (id) => document.getElementById(id);
  const loadButton = byId("load");
  const list = byId("list");
  const status = byId("status");
  const freezeButton = byId("freeze");
  const freezeStatus = byId("freezeStatus");
  const progress = byId("progress");
  const frozen = byId("frozen");
  const hash = byId("hash");
  const limit = byId("limit");

  if (!loadButton || !list || !status || !freezeButton || !freezeStatus || !progress || !frozen || !hash || !limit) {
    throw new Error("blind_v3_ui_markup_missing");
  }

  const storageKey = "buyflow_blind_v3_annotations_" + FREEZE_COMMIT.slice(0, 12);
  let annotations = {};
  try {
    annotations = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    annotations = {};
  }

  let clientPromise = null;
  const getClient = async () => {
    if (!clientPromise) {
      clientPromise = import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) => createClient(
        "https://acjenqkrvnkdvvgordry.supabase.co",
        "sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp",
      ));
    }
    return clientPromise;
  };

  const auth = async () => {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Jelentkezz be a BuyFlow-ba.");
    return data.session.access_token;
  };

  const option = (value, label) => {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
  };

  const createValueControl = (field) => {
    if (field === "eventType" || field === "paymentStatus") {
      const select = document.createElement("select");
      select.className = "known";
      select.dataset.value = "1";
      select.append(option("", ""));
      const values = field === "eventType" ? EVENT_TYPES : PAYMENT_STATUSES;
      values.forEach((value) => select.append(option(value, value)));
      return select;
    }
    if (field === "products") {
      const textarea = document.createElement("textarea");
      textarea.className = "known";
      textarea.dataset.value = "1";
      textarea.placeholder = "products JSON array";
      return textarea;
    }
    const input = document.createElement("input");
    input.className = "known";
    input.dataset.value = "1";
    input.type = field === "total" ? "number" : "text";
    if (field === "total") input.step = "0.01";
    return input;
  };

  const createFieldRow = (field) => {
    const row = document.createElement("div");
    row.className = "field";
    row.dataset.field = field;

    const label = document.createElement("label");
    label.textContent = field;

    const state = document.createElement("select");
    state.dataset.state = "1";
    state.append(option("", "— válassz —"));
    state.append(option("known", "known"));
    state.append(option("not_applicable", "not_applicable"));
    state.append(option("unknown", "unknown"));

    const holder = document.createElement("div");
    holder.append(createValueControl(field));
    row.append(label, state, holder);
    return row;
  };

  const save = () => localStorage.setItem(storageKey, JSON.stringify(annotations));

  const toggleValue = (row) => {
    const state = row.querySelector("[data-state]");
    const value = row.querySelector("[data-value]");
    if (!state || !value) return;
    value.disabled = state.value !== "known";
  };

  const readCard = (card) => {
    const commerce = card.querySelector("[data-commerce]");
    const item = {
      isCommerceEvent: commerce ? commerce.value === "yes" : false,
      commerceSelected: Boolean(commerce && commerce.value),
      fields: {},
    };
    card.querySelectorAll("[data-field]").forEach((row) => {
      const field = row.dataset.field;
      const state = row.querySelector("[data-state]");
      const value = row.querySelector("[data-value]");
      if (!field || !state || !value) return;
      item.fields[field] = { state: state.value, value: value.value };
    });
    annotations[card.dataset.caseId] = item;
    save();
    return item;
  };

  const applyStored = (card) => {
    const item = annotations[card.dataset.caseId];
    if (!item) return;
    const commerce = card.querySelector("[data-commerce]");
    if (commerce) commerce.value = item.commerceSelected ? (item.isCommerceEvent ? "yes" : "no") : "";
    FIELDS.forEach((field) => {
      const row = card.querySelector('[data-field="' + field + '"]');
      const saved = item.fields && item.fields[field];
      if (!row || !saved) return;
      const state = row.querySelector("[data-state]");
      const value = row.querySelector("[data-value]");
      if (state) state.value = saved.state || "";
      if (value) value.value = saved.value == null ? "" : saved.value;
      toggleValue(row);
    });
  };

  const complete = (item) => item && item.commerceSelected && FIELDS.every((field) => {
    const expectation = item.fields && item.fields[field];
    if (!expectation || !expectation.state) return false;
    if (expectation.state !== "known") return true;
    if (field === "products") {
      try {
        return Array.isArray(JSON.parse(expectation.value));
      } catch {
        return false;
      }
    }
    if (field === "total") return expectation.value !== "" && Number.isFinite(Number(expectation.value));
    return String(expectation.value || "").trim().length > 0;
  });

  const updateProgress = () => {
    const cards = Array.from(document.querySelectorAll(".candidate"));
    const done = cards.filter((card) => complete(readCard(card))).length;
    progress.textContent = cards.length ? "Kész: " + done + " / " + cards.length : "";
    freezeButton.disabled = !cards.length || done !== cards.length;
  };

  const markNoise = (card) => {
    const commerce = card.querySelector("[data-commerce]");
    if (commerce) commerce.value = "no";
    card.querySelectorAll("[data-field]").forEach((row) => {
      const state = row.querySelector("[data-state]");
      const value = row.querySelector("[data-value]");
      if (state) state.value = "not_applicable";
      if (value) value.value = "";
      toggleValue(row);
    });
    updateProgress();
  };

  const markCommerce = (card) => {
    const commerce = card.querySelector("[data-commerce]");
    if (commerce) commerce.value = "yes";
    updateProgress();
  };

  const buildCard = (message, index) => {
    const card = document.createElement("div");
    card.className = "c candidate";
    card.dataset.caseId = message.caseId;

    const title = document.createElement("h2");
    title.textContent = "C" + (index + 1) + " · " + String(message.caseId || "").slice(0, 16) + "…";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = String(message.receivedAt || "") + " · " + String((message.sender && message.sender.name) || "") + " <" + String((message.sender && message.sender.address) || "") + "> · body: " + String(message.bodySource || "");

    const subject = document.createElement("h3");
    subject.textContent = message.subject || "";

    const body = document.createElement("pre");
    body.className = "mail";
    body.textContent = message.bodyText || "";

    card.append(title, meta, subject, body);

    if (Array.isArray(message.attachments) && message.attachments.length) {
      const attachments = document.createElement("p");
      attachments.className = "meta";
      attachments.textContent = "Attachments: " + message.attachments.map((item) => String(item.filename || "") + " (" + String(item.contentType || "") + ")").join(", ");
      card.append(attachments);
    }

    const actions = document.createElement("p");
    const commerce = document.createElement("select");
    commerce.dataset.commerce = "1";
    commerce.append(option("", "— commerce? —"));
    commerce.append(option("yes", "YES · commerce event"));
    commerce.append(option("no", "NO · noise/non-commerce"));

    const commerceButton = document.createElement("button");
    commerceButton.type = "button";
    commerceButton.dataset.commerceAction = "1";
    commerceButton.textContent = "Commerce";

    const noiseButton = document.createElement("button");
    noiseButton.type = "button";
    noiseButton.className = "secondary";
    noiseButton.dataset.noise = "1";
    noiseButton.textContent = "Nem commerce";

    actions.append(commerce, document.createTextNode(" "), commerceButton, document.createTextNode(" "), noiseButton);
    card.append(actions);
    FIELDS.forEach((field) => card.append(createFieldRow(field)));
    card.querySelectorAll("[data-field]").forEach(toggleValue);
    applyStored(card);
    return card;
  };

  list.addEventListener("change", (event) => {
    const row = event.target && event.target.closest ? event.target.closest("[data-field]") : null;
    if (row) toggleValue(row);
    updateProgress();
  });
  list.addEventListener("input", updateProgress);
  list.addEventListener("click", (event) => {
    const card = event.target && event.target.closest ? event.target.closest(".candidate") : null;
    if (!card) return;
    if (event.target.matches && event.target.matches("[data-noise]")) markNoise(card);
    if (event.target.matches && event.target.matches("[data-commerce-action]")) markCommerce(card);
  });

  loadButton.addEventListener("click", async () => {
    loadButton.disabled = true;
    status.className = "";
    status.textContent = " Betöltés…";
    list.replaceChildren();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const token = await auth();
      const response = await fetch("/api/audit/blind-v3/candidates?limit=" + encodeURIComponent(limit.value), {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "candidate_load_failed");
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      status.textContent = " " + candidates.length + " jelölt · összes post-freeze: " + data.availablePostFreeze + " · scanned: " + data.scanned;
      if (!candidates.length) {
        const empty = document.createElement("div");
        empty.className = "c";
        const heading = document.createElement("h2");
        heading.textContent = "Még nincs post-freeze levél.";
        const note = document.createElement("p");
        note.className = "muted";
        note.textContent = "Cutoff: " + CUTOFF + ". A vakteszt integritása miatt régi leveleket nem emelünk be helyettük.";
        empty.append(heading, note);
        list.append(empty);
        return;
      }
      candidates.forEach((message, index) => list.append(buildCard(message, index)));
      updateProgress();
    } catch (error) {
      const aborted = error && error.name === "AbortError";
      status.textContent = aborted
        ? " Hiba: a levélbetöltés 30 másodperc után megszakadt."
        : " Hiba: " + (error && error.message ? error.message : String(error));
      status.className = "bad";
    } finally {
      clearTimeout(timer);
      loadButton.disabled = false;
    }
  });

  const truthFromCards = () => Array.from(document.querySelectorAll(".candidate")).map((card) => {
    const item = readCard(card);
    const fields = {};
    FIELDS.forEach((field) => {
      const expectation = item.fields[field];
      if (expectation.state === "known") {
        let value = expectation.value;
        if (field === "total") value = Number(value);
        else if (field === "products") value = JSON.parse(value);
        fields[field] = { state: "known", value };
      } else {
        fields[field] = { state: expectation.state };
      }
    });
    return { caseId: card.dataset.caseId, isCommerceEvent: item.isCommerceEvent, fields };
  });

  freezeButton.addEventListener("click", async () => {
    freezeButton.disabled = true;
    freezeStatus.textContent = " Lezárás…";
    try {
      const token = await auth();
      const response = await fetch("/api/audit/blind-v3/freeze", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ truth: truthFromCards() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "freeze_failed");
      frozen.value = data.canonicalJson;
      hash.textContent = "SHA-256: " + data.truthSha256 + " · Cases: " + data.cases + " · engineRun: NO · 0 write · 0 AI";
      freezeStatus.textContent = " LEZÁRVA. A motor még nem futott.";
      freezeStatus.className = "good";
    } catch (error) {
      freezeStatus.textContent = " Hiba: " + (error && error.message ? error.message : String(error));
      freezeStatus.className = "bad";
      freezeButton.disabled = false;
    }
  });

  status.textContent = " UI kész.";
  status.className = "good";
})();`;
}

export async function registerBlindHoldoutV3Annotation(app: FastifyInstance) {
  app.get('/audit-blind-v3-annotate', async (_request, reply) => reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .send(pageHtml()));

  app.get('/audit-blind-v3-annotate.js', async (_request, reply) => reply
    .type('text/javascript; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .send(clientScript()));

  app.post<{ Querystring: { limit?: string } }>('/api/audit/blind-v3/candidates', async (request, reply) => {
    const user = await resolveUser(request, reply);
    if (!user) return;
    try {
      const result = await loadCandidates(user.id, candidateLimit(request.query.limit));
      return reply.send({
        ok: true,
        mode: 'ground_truth_annotation',
        engineRun: false,
        productionWrites: 0,
        aiCalls: 0,
        candidateFreezeCommit: BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT,
        selectionCutoff: BLIND_HOLDOUT_V3_SELECTION_CUTOFF,
        ...result,
      });
    } catch (error) {
      request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Blind v3 candidate read failed');
      return reply.code(503).send({ error: error instanceof Error ? error.message : 'blind_v3_candidate_read_failed' });
    }
  });

  app.post<{ Body: { truth?: unknown } }>('/api/audit/blind-v3/freeze', async (request, reply) => {
    const user = await resolveUser(request, reply);
    if (!user) return;
    try {
      const result = freezeBlindHoldoutV3Truth(request.body?.truth);
      return reply.send({
        ok: true,
        mode: 'ground_truth_freeze',
        engineRun: false,
        productionWrites: 0,
        aiCalls: 0,
        cases: result.bundle.truth.length,
        truthSha256: result.truthSha256,
        canonicalJson: result.canonicalJson,
        bundle: result.bundle,
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'blind_v3_freeze_failed' });
    }
  });
}
