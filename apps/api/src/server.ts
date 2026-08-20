import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerAppApiRoutes } from './api/app-routes.js';
import { registerEmailAuditRoutes } from './api/email-audit-routes.js';
import { registerEmailConnectionRoutes } from './api/email-connection-routes.js';
import { registerEmailScanReviewRoutes } from './api/email-scan-review-routes.js';
import { registerProductActionRoutes } from './api/product-action-routes.js';
import { registerPurchaseRecoveryRoutes } from './api/purchase-recovery-routes.js';
import { registerShoppingEmailRoutes } from './api/shopping-email-routes.js';
import { registerFieldBlindHoldoutV2 } from './api/field-blind-holdout-v2.js';
import { passwordResetPageHtml } from './auth/reset-password-page.js';
import { env, requireNylasWebhookSecret } from './config.js';
import { registerMailgunInboundRoutes } from './email/mailgun-inbound.js';
import { drainAlzaInternalFulfillmentRecoveryV1 } from './ingestion/alza-internal-fulfillment-recovery-v1.js';
import { drainCorroboratedDocumentRecoveryV1 } from './ingestion/corroborated-document-recovery-v1.js';
import { drainEmailScanJobs } from './ingestion/email-scan-jobs.js';
import { drainHistoricalPurchaseReconstructionV1 } from './ingestion/historical-purchase-reconstruction-v1.js';
import { drainInvoiceAnchorRecoveryV1 } from './ingestion/invoice-anchor-recovery-v1.js';
import { drainPendingAuditBackfillV1 } from './ingestion/pending-audit-backfill-v1.js';
import { drainReviewResolverV3 } from './ingestion/review-resolver-v3.js';
import { drainTrackingBridgeRecoveryV21 } from './ingestion/tracking-bridge-recovery-v21.js';
import { drainUnlinkedRecoveryV2 } from './ingestion/unlinked-recovery-v2.js';
import { registerWebPreview } from './web-preview.js';
import { drainWebhookInbox, enqueueNylasMessageEvent, processWebhookInboxEvent } from './webhooks/webhook-inbox.js';
import { parseNylasMessageCreatedEvent, verifyNylasSignature } from './webhooks/nylas-webhook.js';

const app = Fastify({ logger: true });
const deployedGitCommit = process.env.RENDER_GIT_COMMIT ?? null;
const allowedAppOrigins = new Set(['https://localhost','capacitor://localhost','http://localhost:5173','http://127.0.0.1:5173']);
await app.register(cors,{origin(origin,callback){if(!origin||allowedAppOrigins.has(origin)){callback(null,true);return}callback(null,false)},methods:['GET','POST','PATCH','HEAD','OPTIONS'],allowedHeaders:['Authorization','Content-Type','Accept'],credentials:false,maxAge:86400});
const webhookStats={postsReceived:0,invalidSignatures:0,validSignatures:0,parsedMessageCreated:0,unsupportedSignedEvents:0,inboxPersisted:0,inboxPersistenceFailed:0,inboxClaimed:0,pipelineCompleted:0,pipelineFailed:0,unknownGrant:0,recoveryRuns:0,recoveryClaimed:0,recoveryFailed:0,emailScanRecoveryRuns:0,emailScanRecoveryClaimed:0,emailScanRecoveryFailed:0};
app.removeContentTypeParser('application/json');app.addContentTypeParser('application/json',{parseAs:'buffer'},(request,body,done)=>{if(request.url.startsWith('/webhooks/nylas')){done(null,body);return}try{done(null,JSON.parse(body.toString('utf8')) as unknown)}catch(error){done(error as Error,undefined)}});
await registerMailgunInboundRoutes(app);await registerAppApiRoutes(app);await registerProductActionRoutes(app);await registerEmailConnectionRoutes(app);await registerShoppingEmailRoutes(app);await registerEmailScanReviewRoutes(app);await registerEmailAuditRoutes(app);await registerPurchaseRecoveryRoutes(app);await registerFieldBlindHoldoutV2(app);await registerWebPreview(app);
app.get('/auth/reset-password',async(_request,reply)=>reply.code(200).type('text/html; charset=utf-8').header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('X-Content-Type-Options','nosniff').send(passwordResetPageHtml()));
app.get('/health',async()=>({ok:true,service:'buyflow-api',version:'0.4.0',commit:deployedGitCommit,automationMode:env.BUYFLOW_AUTOMATION_MODE,webhook:{...webhookStats}}));
app.get<{Querystring:{challenge?:string}}>('/webhooks/nylas',async(request,reply)=>{const challenge=request.query.challenge;if(!challenge)return reply.code(400).type('text/plain').send('missing challenge');return reply.code(200).type('text/plain').header('Content-Length',Buffer.byteLength(challenge).toString()).send(challenge)});
async function runInboxEvent(eventId:string){try{const result=await processWebhookInboxEvent(eventId,env.BUYFLOW_AUTOMATION_MODE);if(!result.claimed)return;webhookStats.inboxClaimed+=1;if(result.pipeline){webhookStats.pipelineCompleted+=1;if(result.pipeline.status==='unknown_grant')webhookStats.unknownGrant+=1;app.log.info({pipelineStatus:result.pipeline.status,purchaseWrites:result.pipeline.purchaseWrites,shipmentWrites:result.pipeline.shipmentWrites,documentWrites:result.pipeline.documentWrites,aiCalls:result.pipeline.aiCalls,automationMode:env.BUYFLOW_AUTOMATION_MODE},'Durable Nylas message pipeline completed')}}catch(error){webhookStats.pipelineFailed+=1;app.log.error({errorType:error instanceof Error?error.name:'UnknownError'},'Durable Nylas message pipeline failed and was scheduled for retry')}}
async function runRecovery(){try{const result=await drainWebhookInbox(env.BUYFLOW_AUTOMATION_MODE);webhookStats.recoveryRuns+=1;webhookStats.recoveryClaimed+=result.claimed;webhookStats.recoveryFailed+=result.failed}catch(error){webhookStats.recoveryFailed+=1;app.log.error({errorType:error instanceof Error?error.name:'UnknownError'},'Webhook inbox recovery scan failed')}
try{await drainInvoiceAnchorRecoveryV1(env.BUYFLOW_AUTOMATION_MODE)}catch{} try{const result=await drainEmailScanJobs(env.BUYFLOW_AUTOMATION_MODE);webhookStats.emailScanRecoveryRuns+=1;webhookStats.emailScanRecoveryClaimed+=result.claimed;webhookStats.emailScanRecoveryFailed+=result.failed}catch{} try{await drainAlzaInternalFulfillmentRecoveryV1(env.BUYFLOW_AUTOMATION_MODE)}catch{} try{await drainPendingAuditBackfillV1(env.BUYFLOW_AUTOMATION_MODE)}catch{} try{await drainCorroboratedDocumentRecoveryV1(env.BUYFLOW_AUTOMATION_MODE)}catch{} try{await drainHistoricalPurchaseReconstructionV1(env.BUYFLOW_AUTOMATION_MODE)}catch{} try{await drainReviewResolverV3(env.BUYFLOW_AUTOMATION_MODE)}catch{} try{await drainTrackingBridgeRecoveryV21(env.BUYFLOW_AUTOMATION_MODE)}catch{} try{await drainUnlinkedRecoveryV2(env.BUYFLOW_AUTOMATION_MODE)}catch{}}
app.post('/webhooks/nylas',async(request,reply)=>{webhookStats.postsReceived+=1;const secret=requireNylasWebhookSecret();const rawBody=Buffer.isBuffer(request.body)?request.body:Buffer.from(JSON.stringify(request.body??{}));const signature=request.headers['x-nylas-signature'];if(!verifyNylasSignature(rawBody,typeof signature==='string'?signature:undefined,secret)){webhookStats.invalidSignatures+=1;return reply.code(401).send({ok:false})}webhookStats.validSignatures+=1;const event=parseNylasMessageCreatedEvent(JSON.parse(rawBody.toString('utf8')));if(!event){webhookStats.unsupportedSignedEvents+=1;return reply.code(200).send({ok:true,ignored:true})}webhookStats.parsedMessageCreated+=1;const persisted=await enqueueNylasMessageEvent(event);if(persisted.persisted)webhookStats.inboxPersisted+=1;else webhookStats.inboxPersistenceFailed+=1;void runInboxEvent(persisted.eventId);return reply.code(202).send({ok:true})});
setInterval(()=>void runRecovery(),60_000).unref();void runRecovery();
const port=Number(process.env.PORT??3000);await app.listen({port,host:'0.0.0.0'});
