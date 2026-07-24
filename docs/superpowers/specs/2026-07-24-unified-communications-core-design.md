# Unified Communications Core — Design Spec (v1)

## Goal

Give DEMM CRM operators one place to send/receive SMS and email per Contact/ClientAccount, trigger missed-call text-back, and enforce consent/opt-out — built against provider-neutral interfaces so Twilio and Resend can be swapped later without touching CRM business logic (`Contact`, `Conversation`, `Message`, `Task`, automation, DOM26-R services never import a provider SDK directly).

## Provider decision (locked by Antwann, 2026-07-24)

- SMS + voice: **Twilio**.
- Outbound email: **Resend**.
- Inbound email: **Resend Receiving** (not Postmark/Mailgun — one vendor for both email directions).
- Real accounts/numbers/DNS: **not authorized yet**. Foundation + adapters + mocked/signed-fixture tests build now; real end-to-end proof waits for Antwann's go-ahead on account setup.

## Hard constraints (carried over / new)

- No provider-specific logic in `Contact`, `Conversation`, `Message`, `Task`, automation, or DOM26-R services — those only ever call the 5 interfaces below.
- No real Twilio number purchase, no paid-plan upgrade, no production DNS change, no message to a real customer, no production deploy — all staging/test-mode/local only, exactly like the Stripe sub-project's own constraint.
- The app must build, and provider-neutral tests must pass, with zero provider credentials configured. Real-send controls disabled; UI states "not connected"; nothing is ever marked sent that wasn't actually sent.
- Business Unit isolation on every inbound webhook — a wrong-tenant message landing in the wrong BU's inbox is a privacy incident, not a bug to triage later.
- Never log/print/commit/screenshot a real secret value (webhook signing secrets, API keys) — same boundary as `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` all along.
- Completion language until real providers are connected and proven end-to-end: **"COMMUNICATION FOUNDATION COMPLETE — PROVIDER ACTIVATION PENDING."** Never claim "OPERATIONAL" before Stage 3 passes for real.

## 1. Schema

All new models are workspace-scoped (matching `Contact`/`Task`/`Opportunity`) with cascade-delete from `Workspace`, so Business Unit isolation is enforced the same way existing models enforce it — via `workspaceId` ownership checks in every service method, never trusting a client-supplied ID alone.

```prisma
enum ChannelType {
  SMS
  VOICE
  EMAIL
}

enum ChannelProvider {
  TWILIO
  RESEND
}

enum ChannelConnectionStatus {
  NOT_CONFIGURED
  CONFIGURED
  VERIFYING
  ACTIVE
  DEGRADED
  DISCONNECTED
}

model ChannelConnection {
  id             String                   @id @default(uuid())
  workspaceId    String
  workspace      Workspace                @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  businessUnitId String
  businessUnit   BusinessUnit             @relation(fields: [businessUnitId], references: [id], onDelete: Cascade)
  type           ChannelType
  provider       ChannelProvider
  status         ChannelConnectionStatus  @default(NOT_CONFIGURED)
  // The externally-addressable identity for this channel -- a Twilio phone
  // number in E.164, or a Resend sending/receiving address. Nullable until
  // an operator (or the GHL-number-reuse path) actually assigns one --
  // NOT_CONFIGURED rows can exist with this null.
  externalAddress String?
  // Provider-specific config that isn't a secret (e.g. Twilio Messaging
  // Service SID, Resend domain ID) -- actual API keys/webhook secrets live
  // in GCP Secret Manager only, never in this table.
  providerConfig Json?
  lastVerifiedAt DateTime?
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt
  conversations  Conversation[]

  @@unique([businessUnitId, type, provider])
  @@index([workspaceId, status])
}

enum ConversationChannel {
  SMS
  EMAIL
}

model Conversation {
  id                  String              @id @default(uuid())
  workspaceId         String
  workspace           Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  businessUnitId      String
  businessUnit        BusinessUnit        @relation(fields: [businessUnitId], references: [id], onDelete: Cascade)
  channelConnectionId String
  channelConnection   ChannelConnection   @relation(fields: [channelConnectionId], references: [id], onDelete: Restrict)
  channel             ConversationChannel
  contactId           String?
  contact             Contact?            @relation(fields: [contactId], references: [id], onDelete: SetNull)
  clientAccountId     String?
  clientAccount       ClientAccount?      @relation(fields: [clientAccountId], references: [id], onDelete: SetNull)
  // The other party's address -- E.164 phone or email address. This plus
  // channelConnectionId is how inbound webhooks resolve which Conversation
  // a new Message belongs to (see "Threading" below).
  counterpartyAddress String
  // Per-conversation-per-email-thread reply routing. Only set for EMAIL
  // conversations: a stable, unguessable local-part
  // (reply+{token}@reply.demmmarketing.com) that Resend Receiving delivers
  // back to us, letting us resolve the Conversation without parsing
  // In-Reply-To/References headers (which real mail clients mangle).
  replyToken   String?  @unique
  lastMessageAt DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  messages     Message[]

  @@unique([channelConnectionId, counterpartyAddress])
  @@index([workspaceId, lastMessageAt])
  @@index([contactId])
}

enum MessageDirection {
  OUTBOUND
  INBOUND
}

enum MessageStatus {
  QUEUED
  SENT
  DELIVERED
  FAILED
  UNDELIVERED
  RECEIVED
}

model Message {
  id             String            @id @default(uuid())
  conversationId String
  conversation   Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  direction      MessageDirection
  status         MessageStatus
  body           String?
  // EMAIL only. Attachments referenced by a secure storage path/URL the
  // approved file pipeline issued -- never a raw inline blob, never a
  // client-supplied arbitrary URL fetched server-side (SSRF surface).
  attachments    Json?
  // Idempotency/audit: the provider's own message ID (Twilio MessageSid /
  // CallSid, Resend email ID), unique so a redelivered webhook can never
  // create a second Message for the same provider event.
  providerMessageId String? @unique
  sentByUserId      String?
  sentByUser        User?             @relation(fields: [sentByUserId], references: [id], onDelete: SetNull)
  templateId        String?
  template          MessageTemplate?  @relation(fields: [templateId], references: [id], onDelete: SetNull)
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
  deliveryAttempts   DeliveryAttempt[]

  @@index([conversationId, createdAt])
}

enum DeliveryAttemptOutcome {
  SUCCEEDED
  FAILED
  UNDELIVERED
  BOUNCED
  COMPLAINED
}

model DeliveryAttempt {
  id          String                 @id @default(uuid())
  messageId   String
  message     Message                @relation(fields: [messageId], references: [id], onDelete: Cascade)
  outcome     DeliveryAttemptOutcome
  providerCode String?  // Twilio ErrorCode / Resend bounce type, raw passthrough for support/debugging
  providerRaw  Json?    // full provider callback payload, for audit -- never contains a secret, only message metadata
  occurredAt   DateTime
  createdAt    DateTime @default(now())

  @@index([messageId, occurredAt])
}

enum CommunicationEventType {
  CONSENT_STOP
  CONSENT_START
  CONSENT_HELP
  UNSUBSCRIBE
  COMPLAINT
  MISSED_CALL_DETECTED
  MISSED_CALL_TEXTBACK_SENT
  MISSED_CALL_TEXTBACK_SUPPRESSED_COOLDOWN
}

model CommunicationEvent {
  id             String                 @id @default(uuid())
  workspaceId    String
  workspace      Workspace              @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  conversationId String?
  conversation   Conversation?          @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  contactId      String?
  contact        Contact?               @relation(fields: [contactId], references: [id], onDelete: SetNull)
  type           CommunicationEventType
  detail         String?
  createdAt      DateTime               @default(now())

  @@index([workspaceId, type, createdAt])
}

enum ConsentChannelType {
  SMS
  EMAIL
}

// Distinct from the existing DOM26-R ConsentStatus/ConsentDirective (memory-
// retention consent) -- this is TCPA/CAN-SPAM message consent, a different
// legal concept. Deliberately not reusing the DOM26-R enum/model so the two
// domains never get conflated in code or in an audit.
model CommunicationConsent {
  id          String             @id @default(uuid())
  workspaceId String
  workspace   Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  contactId   String
  contact     Contact            @relation(fields: [contactId], references: [id], onDelete: Cascade)
  channel     ConsentChannelType
  optedOut    Boolean            @default(false)
  reason      String?            // "STOP" / "unsubscribe-link" / "complaint" / operator-entered
  updatedAt   DateTime           @updatedAt
  createdAt   DateTime           @default(now())

  @@unique([contactId, channel])
}

model MessageTemplate {
  id             String       @id @default(uuid())
  workspaceId    String
  workspace      Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  businessUnitId String
  businessUnit   BusinessUnit @relation(fields: [businessUnitId], references: [id], onDelete: Cascade)
  channel        ConversationChannel
  name           String
  body           String       // supports {{firstName}}-style tokens, resolved server-side at send time
  active         Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  messages       Message[]

  @@unique([businessUnitId, channel, name])
}

enum CallOutcome {
  ANSWERED
  NO_ANSWER
  BUSY
  FAILED
  CANCELED
  VOICEMAIL
}

model CallEvent {
  id                  String            @id @default(uuid())
  workspaceId         String
  workspace           Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  channelConnectionId String
  channelConnection   ChannelConnection @relation(fields: [channelConnectionId], references: [id], onDelete: Restrict)
  contactId           String?
  contact             Contact?          @relation(fields: [contactId], references: [id], onDelete: SetNull)
  providerCallId      String            @unique // Twilio CallSid -- idempotency key for out-of-order status callbacks
  fromAddress         String
  outcome             CallOutcome?      // null until the FINAL status callback resolves it -- see missed-call rule below
  textBackSent        Boolean           @default(false)
  startedAt           DateTime
  resolvedAt          DateTime?
  createdAt           DateTime          @default(now())

  @@index([workspaceId, contactId, startedAt])
  @@index([fromAddress, startedAt])
}
```

Migration is additive-only (new tables, no touched columns on existing models), same discipline as every prior sub-project.

## 2. Provider interfaces

Five interfaces, defined once in `backend/src/modules/communications/interfaces/`, with zero Twilio/Resend types leaking into their signatures (only plain strings/enums/our own DTOs):

```typescript
interface SmsProvider {
  sendSms(params: { to: string; from: string; body: string }): Promise<{ providerMessageId: string }>;
  verifyInboundWebhookSignature(rawBody: string, signatureHeader: string, url: string): boolean;
  parseInboundSms(rawBody: unknown): InboundSmsPayload;
}

interface VoiceProvider {
  verifyInboundWebhookSignature(rawBody: string, signatureHeader: string, url: string): boolean;
  parseVoiceStatusCallback(rawBody: unknown): VoiceStatusPayload;
}

interface EmailProvider {
  sendEmail(params: { to: string; from: string; replyTo?: string; subject: string; html: string; attachments?: SecureAttachmentRef[] }): Promise<{ providerMessageId: string }>;
  verifyOutboundWebhookSignature(rawBody: string, signatureHeader: string): boolean; // delivery/bounce/complaint events
}

interface InboundEmailProvider {
  verifyInboundWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  parseInboundEmail(rawBody: unknown): InboundEmailPayload;
}

interface DeliveryStatusProvider {
  // Shared shape both Twilio (SMS/voice) and Resend (email) status
  // callbacks get normalized into before DeliveryAttempt is written --
  // this is what keeps DeliveryAttempt provider-agnostic.
  normalizeStatus(providerName: 'TWILIO' | 'RESEND', rawEvent: unknown): DeliveryAttemptOutcome;
}
```

`TwilioAdapter implements SmsProvider, VoiceProvider, DeliveryStatusProvider` and `ResendAdapter implements EmailProvider, InboundEmailProvider, DeliveryStatusProvider` live in `backend/src/modules/communications/providers/`. Nest's DI binds the interface tokens to the concrete adapter; when no credentials are configured, a `NullProvider` (throws `ProviderNotConfiguredError` on any send attempt, returns `false` on signature verification) is bound instead — this is what makes "app builds and tests pass with zero credentials" mechanical rather than a special-cased `if` scattered through business logic.

## 3. Missed-call rule (the part that must not over-fire)

`CallEvent.outcome` starts `null` at call-start (`initiated`/`ringing` Twilio status). Twilio sends a sequence of status callbacks for one `CallSid` that can arrive **out of order** — the rule engine only acts on the callback whose `CallStatus` is one of the **terminal** states (`completed`, `no-answer`, `busy`, `failed`, `canceled`), and only overwrites `outcome` if the incoming callback's `Timestamp` is >= the currently-stored `resolvedAt` (out-of-order guard — a stale terminal callback arriving after a fresher one must never revert the outcome). `completed` with `CallDuration: "0"` and no recording is treated as unanswered (voicemail detection: Twilio's `AnsweringMachineDetection` result, when enabled, maps to `VOICEMAIL` directly instead of guessing from duration).

Missed-call text-back fires only when: outcome is one of `NO_ANSWER`/`BUSY`/`CANCELED` (deliberately not `FAILED` — a carrier-level failure isn't "they didn't pick up," texting back would be misleading), `textBackSent` is still `false`, and no other `CallEvent` from the same `fromAddress` to the same `ChannelConnection` had a text-back sent within the configurable cooldown window (default 30 min, stored as workspace config, not hardcoded). This is a single atomic DB check-and-set (transaction, same discipline as the Stripe webhook dedup lock) so two near-simultaneous status callbacks for edge-case rapid re-dials can't double-fire.

## 4. Email threading (Resend Receiving)

Every `EMAIL` `Conversation` gets a `replyToken` (opaque random ID, not the contact's real address) at creation. Outbound emails set `Reply-To: reply+{replyToken}@reply.demmmarketing.com`. Resend Receiving delivers the reply to that address; the inbound webhook parses the local-part token, looks up the `Conversation` directly by `replyToken` — no dependency on `In-Reply-To`/`References` headers, which real-world mail clients (especially top-posting/quote-mangling ones) are unreliable for. A reply to an address whose token doesn't resolve to a `Conversation` is logged as an anomaly, not silently dropped and not silently attached to the wrong thread.

## 5. Consent / opt-out

SMS: an inbound message body matching `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT` (case-insensitive, Twilio's own standard keyword list) writes `CommunicationConsent(channel: SMS, optedOut: true)` and a `CommunicationEvent(CONSENT_STOP)`, and **every future outbound SMS to that Contact is blocked at the service layer** (checked before calling `SmsProvider.sendSms`, not left to Twilio's own carrier-level filtering as the only safeguard). `START`/`YES`/`UNSTOP` reverses it (`CONSENT_START`). `HELP`/`INFO` logs `CONSENT_HELP` and should trigger an auto-reply with support contact info (template-driven, not hardcoded copy).

Email: Resend's own unsubscribe-link mechanism plus an explicit `List-Unsubscribe` header on every outbound send; the unsubscribe webhook event writes the same `CommunicationConsent(channel: EMAIL, optedOut: true)` row. A `complaint` event (spam report) also sets `optedOut: true` — a complaint is a stronger signal than a soft bounce and must not be treated as "maybe try again."

## 6. Provider configuration status states

`ChannelConnectionStatus` (`NOT_CONFIGURED` → `CONFIGURED` → `VERIFYING` → `ACTIVE` / `DEGRADED` / `DISCONNECTED`) is surfaced directly in the Inbox UI as a banner, never silently hidden. `NOT_CONFIGURED` is the only state possible with zero secrets present — the seed/migration ships every workspace's `ChannelConnection` rows in this state by default. No code path may mark a `Message.status` as `SENT` without a real `providerMessageId` from a real (or Stage-2 signed-fixture) provider call succeeding first.

## 7. DOM26-R integration

`CommunicationEvent` rows (missed-call detected/texted, consent changes) feed `RelationshipSignal` creation the same way `BillingRelationshipSignalService` already does for Stripe events — a new `CommunicationRelationshipSignalService` mirrors that file's shape exactly (same DI pattern, same `createSignal`/`resolveSignals`/`hasActiveSignal` methods), not a redesign.

## 8. Testing stages (per Antwann's spec, unchanged)

1. **Provider-neutral**, deterministic fakes (`FakeSmsProvider`, `FakeEmailProvider` implementing the same interfaces) — message creation, send state, inbound ingestion, retries, failures, consent, threading, automation stop, BU isolation, DOM26-R signals. No network calls, no real SDKs invoked.
2. **Adapter contract tests** — Twilio's documented test credentials (Account SID `AC` test mode / magic test phone numbers) and Resend's sandbox/test-mode sending where available, plus hand-built signed-webhook fixtures (using each provider's own signing algorithm against a fixture payload) to prove `verifyInboundWebhookSignature` actually rejects a tampered payload and accepts a correctly-signed one.
3. **Real test-environment verification** — gated entirely on Antwann authorizing real account/number/DNS setup. Not started until that authorization lands.

## Known limitations (stated up front)

- Voicemail transcription/detection quality depends entirely on Twilio's `AnsweringMachineDetection`, which is probabilistic — the schema records what Twilio reports, it does not independently verify it.
- Email attachment handling in v1 supports the approved secure file path only (existing asset storage), not arbitrary inbound-attachment auto-processing (e.g., OCR, virus scanning) — out of scope for this foundation.
- No outbound voice (making calls) in v1 — only inbound call *events* for missed-call detection. Outbound calling is a plausible Release 1.1 candidate, not built here.
