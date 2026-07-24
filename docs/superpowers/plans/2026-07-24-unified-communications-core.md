# Unified Communications Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a provider-neutral Communications Core (SMS + email conversations, missed-call text-back, consent/opt-out, unified Inbox) for DEMM CRM, with Twilio and Resend adapters behind interfaces business logic never sees directly, proven via deterministic-fake tests (Stage 1) and signed-fixture adapter contract tests (Stage 2). Stage 3 (real provider accounts, real messages) is explicitly out of scope for this plan.

**Architecture:** New `backend/src/modules/communications/` NestJS module mirroring the existing `marketing` module's shape (controllers/services/DTOs, guards, Prisma-backed). Five provider interfaces (`SmsProvider`, `VoiceProvider`, `EmailProvider`, `InboundEmailProvider`, `DeliveryStatusProvider`) are the only thing business services depend on; `TwilioAdapter`/`ResendAdapter` implement them, a `NullProvider` set is bound when no credentials exist so the app builds and Stage 1 tests pass with zero secrets configured. New Prisma models: `ChannelConnection`, `Conversation`, `Message`, `DeliveryAttempt`, `CommunicationEvent`, `CommunicationConsent`, `MessageTemplate`, `CallEvent` — additive-only migration.

**Tech Stack:** NestJS, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 16, `twilio` Node SDK, `resend` Node SDK, Next.js 16 (frontend Inbox pages only).

## Global Constraints

- Zero provider-specific logic in `Contact`, `Conversation`, `Message`, `Task`, automation, or DOM26-R services — only the 5 interfaces are ever imported by business logic. A service importing `twilio` or `resend` types directly (outside `providers/twilio-adapter.ts`/`providers/resend-adapter.ts`) is a hard review-blocking defect.
- No real Twilio number purchase, no paid-plan upgrade, no production DNS change, no message to a real customer, no production deployment anywhere in this plan. Everything targets local dev / staging test-mode only, same discipline as the Stripe sub-project.
- The app must build and Stage 1 tests must pass with **zero** provider credentials present. `NullProvider` implementations throw `ProviderNotConfiguredError` on any send attempt and return `false` from signature verification — no `if (configured)` branching scattered through business logic.
- No `Message.status` may ever be set to `SENT`/`DELIVERED` without a real (or Stage-2 signed-fixture) provider call/webhook actually producing that result. Never fabricate a successful send.
- Every inbound webhook enforces Business Unit isolation via the resolved `ChannelConnection.businessUnitId` — a payload that can't be resolved to a connection is rejected (400), never guessed into the wrong tenant.
- Never log, print, commit, or screenshot a real secret value (Twilio auth token, Resend API key, webhook signing secrets). Same boundary as `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` throughout this project.
- Migration is additive-only: new tables/enums, zero modified columns on existing models.
- Completion language: **"COMMUNICATION FOUNDATION COMPLETE — PROVIDER ACTIVATION PENDING"**. Never "OPERATIONAL" — that claim is reserved for Stage 3, which is not part of this plan.
- Existing guard chain (`JwtAuthGuard`, `WorkspaceGuard`, `BusinessUnitGuard`, `CurrentUser` decorator, `Role` enum) is reused exactly as-is on every authenticated route — no new auth mechanism.

---

### Task 1: Prisma schema — Communications Core models

**Files:**
- Modify: `backend/prisma/schema.prisma` (append new enums/models; add back-relations to `Workspace`, `BusinessUnit`, `Contact`, `ClientAccount`, `User`)
- Migration: generated via `npx prisma migrate dev` (do not hand-write the SQL)

**Interfaces:**
- Produces: every model/enum name and field listed below, exactly as spelled — every later task's Prisma calls depend on this spelling being verbatim.

- [ ] **Step 1: Append the new enums and models to `backend/prisma/schema.prisma`**

Add at the end of the file:

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
  id              String                  @id @default(uuid())
  workspaceId     String
  workspace       Workspace               @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  businessUnitId  String
  businessUnit    BusinessUnit            @relation(fields: [businessUnitId], references: [id], onDelete: Cascade)
  type            ChannelType
  provider        ChannelProvider
  status          ChannelConnectionStatus @default(NOT_CONFIGURED)
  externalAddress String?
  providerConfig  Json?
  lastVerifiedAt  DateTime?
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt
  conversations   Conversation[]
  callEvents      CallEvent[]

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
  counterpartyAddress String
  replyToken          String?             @unique
  lastMessageAt       DateTime?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  messages            Message[]
  communicationEvents CommunicationEvent[]

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
  id                String            @id @default(uuid())
  conversationId    String
  conversation      Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  direction         MessageDirection
  status            MessageStatus
  body              String?
  attachments       Json?
  providerMessageId String?           @unique
  sentByUserId      String?
  sentByUser        User?             @relation(fields: [sentByUserId], references: [id], onDelete: SetNull)
  templateId        String?
  template          MessageTemplate?  @relation(fields: [templateId], references: [id], onDelete: SetNull)
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
  deliveryAttempts  DeliveryAttempt[]

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
  id           String                 @id @default(uuid())
  messageId    String
  message      Message                @relation(fields: [messageId], references: [id], onDelete: Cascade)
  outcome      DeliveryAttemptOutcome
  providerCode String?
  providerRaw  Json?
  occurredAt   DateTime
  createdAt    DateTime               @default(now())

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

model CommunicationConsent {
  id          String             @id @default(uuid())
  workspaceId String
  workspace   Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  contactId   String
  contact     Contact            @relation(fields: [contactId], references: [id], onDelete: Cascade)
  channel     ConsentChannelType
  optedOut    Boolean            @default(false)
  reason      String?
  updatedAt   DateTime           @updatedAt
  createdAt   DateTime           @default(now())

  @@unique([contactId, channel])
}

model MessageTemplate {
  id             String              @id @default(uuid())
  workspaceId    String
  workspace      Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  businessUnitId String
  businessUnit   BusinessUnit        @relation(fields: [businessUnitId], references: [id], onDelete: Cascade)
  channel        ConversationChannel
  name           String
  body           String
  active         Boolean             @default(true)
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt
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
  providerCallId      String            @unique
  fromAddress         String
  outcome             CallOutcome?
  textBackSent        Boolean           @default(false)
  startedAt           DateTime
  resolvedAt          DateTime?
  createdAt           DateTime          @default(now())

  @@index([workspaceId, contactId, startedAt])
  @@index([fromAddress, startedAt])
}
```

- [ ] **Step 2: Add back-relations to existing models**

In `Workspace` model, add: `channelConnections ChannelConnection[]`, `conversations Conversation[]`, `communicationEvents CommunicationEvent[]`, `communicationConsents CommunicationConsent[]`, `messageTemplates MessageTemplate[]`, `callEvents CallEvent[]`.

In `BusinessUnit` model, add: `channelConnections ChannelConnection[]`, `conversations Conversation[]`, `messageTemplates MessageTemplate[]`.

In `Contact` model, add: `conversations Conversation[]`, `communicationEvents CommunicationEvent[]`, `communicationConsents CommunicationConsent[]`, `callEvents CallEvent[]`.

In `ClientAccount` model, add: `conversations Conversation[]`.

In `User` model, add: `sentMessages Message[]`.

- [ ] **Step 3: Format and generate the migration**

```bash
cd backend
npx prisma format
npx prisma migrate dev --name communications_core_foundation
```

Expected: migration file created under `backend/prisma/migrations/`, `npx prisma generate` runs automatically, no errors.

- [ ] **Step 4: Verify the migration is additive-only**

```bash
git diff --stat backend/prisma/migrations/
```

Expected: one new migration directory, zero modified files under existing migration directories.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(communications): add Communications Core Prisma schema"
```

---

### Task 2: Provider interfaces and DTOs

**Files:**
- Create: `backend/src/modules/communications/interfaces/sms-provider.interface.ts`
- Create: `backend/src/modules/communications/interfaces/voice-provider.interface.ts`
- Create: `backend/src/modules/communications/interfaces/email-provider.interface.ts`
- Create: `backend/src/modules/communications/interfaces/inbound-email-provider.interface.ts`
- Create: `backend/src/modules/communications/interfaces/delivery-status-provider.interface.ts`
- Create: `backend/src/modules/communications/interfaces/provider-tokens.ts`
- Create: `backend/src/modules/communications/errors/provider-not-configured.error.ts`
- Test: `backend/src/modules/communications/interfaces/interfaces.spec.ts`

**Interfaces:**
- Produces: `SmsProvider`, `VoiceProvider`, `EmailProvider`, `InboundEmailProvider`, `DeliveryStatusProvider` interface shapes below, exact method names/signatures every later task implements or calls. `SMS_PROVIDER`/`VOICE_PROVIDER`/`EMAIL_PROVIDER`/`INBOUND_EMAIL_PROVIDER`/`DELIVERY_STATUS_PROVIDER` DI tokens.

- [ ] **Step 1: Write the DTOs and interfaces**

`backend/src/modules/communications/interfaces/sms-provider.interface.ts`:
```typescript
export interface InboundSmsPayload {
  providerMessageId: string;
  from: string;
  to: string;
  body: string;
}

export interface SmsProvider {
  sendSms(params: {
    to: string;
    from: string;
    body: string;
    statusCallbackUrl?: string; // registers Twilio's per-message delivery-status webhook (see Task 10's sms-status endpoint) -- omitted for providers/fakes that don't support it
  }): Promise<{ providerMessageId: string }>;
  verifyInboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    url: string,
  ): boolean;
  parseInboundSms(rawBody: Record<string, unknown>): InboundSmsPayload;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
```

`backend/src/modules/communications/interfaces/voice-provider.interface.ts`:
```typescript
export interface VoiceStatusPayload {
  providerCallId: string;
  from: string;
  to: string;
  callStatus: string; // raw provider status string, normalized by the caller
  timestamp: Date;
  answeredByMachine?: boolean;
}

export interface VoiceProvider {
  verifyInboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    url: string,
  ): boolean;
  parseVoiceStatusCallback(
    rawBody: Record<string, unknown>,
  ): VoiceStatusPayload;
}

export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');
```

`backend/src/modules/communications/interfaces/email-provider.interface.ts`:
```typescript
export interface SecureAttachmentRef {
  path: string;
  filename: string;
  contentType: string;
}

export interface EmailProvider {
  sendEmail(params: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    attachments?: SecureAttachmentRef[];
  }): Promise<{ providerMessageId: string }>;
  verifyOutboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
  ): boolean;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
```

`backend/src/modules/communications/interfaces/inbound-email-provider.interface.ts`:
```typescript
export interface InboundEmailPayload {
  providerMessageId: string;
  from: string;
  to: string;
  subject: string;
  html: string | null;
  text: string | null;
  replyToken: string | null; // extracted from the reply+{token}@... local-part, if present
}

export interface InboundEmailProvider {
  verifyInboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
  ): boolean;
  parseInboundEmail(rawBody: Record<string, unknown>): InboundEmailPayload;
}

export const INBOUND_EMAIL_PROVIDER = Symbol('INBOUND_EMAIL_PROVIDER');
```

`backend/src/modules/communications/interfaces/delivery-status-provider.interface.ts`:
```typescript
import { DeliveryAttemptOutcome } from '@prisma/client';

export type ProviderName = 'TWILIO' | 'RESEND';

export interface DeliveryStatusProvider {
  normalizeStatus(
    providerName: ProviderName,
    rawEvent: Record<string, unknown>,
  ): DeliveryAttemptOutcome;
}

export const DELIVERY_STATUS_PROVIDER = Symbol('DELIVERY_STATUS_PROVIDER');
```

`backend/src/modules/communications/errors/provider-not-configured.error.ts`:
```typescript
export class ProviderNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(`${providerName} is not configured -- no credentials present.`);
    this.name = 'ProviderNotConfiguredError';
  }
}
```

- [ ] **Step 2: Write the failing test asserting the DI tokens are distinct symbols**

`backend/src/modules/communications/interfaces/interfaces.spec.ts`:
```typescript
import { SMS_PROVIDER } from './sms-provider.interface';
import { VOICE_PROVIDER } from './voice-provider.interface';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { INBOUND_EMAIL_PROVIDER } from './inbound-email-provider.interface';
import { DELIVERY_STATUS_PROVIDER } from './delivery-status-provider.interface';

describe('communications provider DI tokens', () => {
  it('are five distinct symbols', () => {
    const tokens = [
      SMS_PROVIDER,
      VOICE_PROVIDER,
      EMAIL_PROVIDER,
      INBOUND_EMAIL_PROVIDER,
      DELIVERY_STATUS_PROVIDER,
    ];
    expect(new Set(tokens).size).toBe(5);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
cd backend && npx jest interfaces.spec.ts
```
Expected: PASS (this step mainly proves the files compile and export correctly — the interfaces themselves have no runtime behavior yet).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/communications/interfaces/ backend/src/modules/communications/errors/
git commit -m "feat(communications): define provider-neutral interfaces and DI tokens"
```

---

### Task 3: Null providers (zero-credential safe default)

**Files:**
- Create: `backend/src/modules/communications/providers/null-sms-provider.ts`
- Create: `backend/src/modules/communications/providers/null-voice-provider.ts`
- Create: `backend/src/modules/communications/providers/null-email-provider.ts`
- Create: `backend/src/modules/communications/providers/null-inbound-email-provider.ts`
- Create: `backend/src/modules/communications/providers/null-delivery-status-provider.ts`
- Test: `backend/src/modules/communications/providers/null-providers.spec.ts`

**Interfaces:**
- Consumes: `SmsProvider`, `VoiceProvider`, `EmailProvider`, `InboundEmailProvider`, `DeliveryStatusProvider` from Task 2; `ProviderNotConfiguredError`.
- Produces: `NullSmsProvider`, `NullVoiceProvider`, `NullEmailProvider`, `NullInboundEmailProvider`, `NullDeliveryStatusProvider` classes — bound as the default DI implementation in Task 4 when no credentials exist.

- [ ] **Step 1: Write the failing test**

`backend/src/modules/communications/providers/null-providers.spec.ts`:
```typescript
import { NullSmsProvider } from './null-sms-provider';
import { NullEmailProvider } from './null-email-provider';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

describe('Null providers', () => {
  it('NullSmsProvider throws ProviderNotConfiguredError on send', async () => {
    const provider = new NullSmsProvider();
    await expect(
      provider.sendSms({ to: '+15550001111', from: '+15550002222', body: 'hi' }),
    ).rejects.toThrow(ProviderNotConfiguredError);
  });

  it('NullSmsProvider rejects every webhook signature', () => {
    const provider = new NullSmsProvider();
    expect(
      provider.verifyInboundWebhookSignature('body', 'sig', 'https://x'),
    ).toBe(false);
  });

  it('NullEmailProvider throws ProviderNotConfiguredError on send', async () => {
    const provider = new NullEmailProvider();
    await expect(
      provider.sendEmail({
        to: 'a@example.com',
        from: 'b@example.com',
        subject: 'hi',
        html: '<p>hi</p>',
      }),
    ).rejects.toThrow(ProviderNotConfiguredError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest null-providers.spec.ts
```
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement**

`backend/src/modules/communications/providers/null-sms-provider.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SmsProvider, InboundSmsPayload } from '../interfaces/sms-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullSmsProvider implements SmsProvider {
  async sendSms(): Promise<{ providerMessageId: string }> {
    throw new ProviderNotConfiguredError('Twilio SMS');
  }

  verifyInboundWebhookSignature(): boolean {
    return false;
  }

  parseInboundSms(): InboundSmsPayload {
    throw new ProviderNotConfiguredError('Twilio SMS');
  }
}
```

`backend/src/modules/communications/providers/null-voice-provider.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { VoiceProvider, VoiceStatusPayload } from '../interfaces/voice-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullVoiceProvider implements VoiceProvider {
  verifyInboundWebhookSignature(): boolean {
    return false;
  }

  parseVoiceStatusCallback(): VoiceStatusPayload {
    throw new ProviderNotConfiguredError('Twilio Voice');
  }
}
```

`backend/src/modules/communications/providers/null-email-provider.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { EmailProvider } from '../interfaces/email-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullEmailProvider implements EmailProvider {
  async sendEmail(): Promise<{ providerMessageId: string }> {
    throw new ProviderNotConfiguredError('Resend Email');
  }

  verifyOutboundWebhookSignature(): boolean {
    return false;
  }
}
```

`backend/src/modules/communications/providers/null-inbound-email-provider.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import {
  InboundEmailProvider,
  InboundEmailPayload,
} from '../interfaces/inbound-email-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullInboundEmailProvider implements InboundEmailProvider {
  verifyInboundWebhookSignature(): boolean {
    return false;
  }

  parseInboundEmail(): InboundEmailPayload {
    throw new ProviderNotConfiguredError('Resend Receiving');
  }
}
```

`backend/src/modules/communications/providers/null-delivery-status-provider.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { DeliveryStatusProvider } from '../interfaces/delivery-status-provider.interface';
import { ProviderNotConfiguredError } from '../errors/provider-not-configured.error';

@Injectable()
export class NullDeliveryStatusProvider implements DeliveryStatusProvider {
  normalizeStatus(): never {
    throw new ProviderNotConfiguredError('Delivery status');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest null-providers.spec.ts
```
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/communications/providers/null-*.ts backend/src/modules/communications/providers/null-providers.spec.ts
git commit -m "feat(communications): null providers for zero-credential safe default"
```

---

### Task 4: CommunicationsModule wiring + configuration-driven provider binding

**Files:**
- Create: `backend/src/modules/communications/communications.module.ts`
- Create: `backend/src/modules/communications/provider-binding.factory.ts`
- Modify: `backend/src/app.module.ts` (register `CommunicationsModule`)
- Test: `backend/src/modules/communications/provider-binding.factory.spec.ts`

**Interfaces:**
- Consumes: all 5 DI tokens from Task 2, all 5 Null providers from Task 3.
- Produces: `CommunicationsModule` (importable, exports `PrismaService`-backed services built in later tasks), `bindSmsProvider()`/`bindEmailProvider()`/etc. factory functions later tasks' real adapters (Tasks 9, 14) replace by checking env vars.

- [ ] **Step 1: Write the failing test**

`backend/src/modules/communications/provider-binding.factory.spec.ts`:
```typescript
import { bindSmsProvider } from './provider-binding.factory';
import { NullSmsProvider } from './providers/null-sms-provider';

describe('provider-binding.factory', () => {
  const originalEnv = process.env.TWILIO_ACCOUNT_SID;

  afterEach(() => {
    process.env.TWILIO_ACCOUNT_SID = originalEnv;
  });

  it('binds NullSmsProvider when TWILIO_ACCOUNT_SID is unset', () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    expect(bindSmsProvider()).toBeInstanceOf(NullSmsProvider);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest provider-binding.factory.spec.ts
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the binding factory (Twilio/Resend branches added in Tasks 9 and 14 — this step only wires the Null default)**

`backend/src/modules/communications/provider-binding.factory.ts`:
```typescript
import { SmsProvider } from './interfaces/sms-provider.interface';
import { VoiceProvider } from './interfaces/voice-provider.interface';
import { EmailProvider } from './interfaces/email-provider.interface';
import { InboundEmailProvider } from './interfaces/inbound-email-provider.interface';
import { DeliveryStatusProvider } from './interfaces/delivery-status-provider.interface';
import { NullSmsProvider } from './providers/null-sms-provider';
import { NullVoiceProvider } from './providers/null-voice-provider';
import { NullEmailProvider } from './providers/null-email-provider';
import { NullInboundEmailProvider } from './providers/null-inbound-email-provider';
import { NullDeliveryStatusProvider } from './providers/null-delivery-status-provider';

// Each function is intentionally a plain factory (not a class) so
// CommunicationsModule's `useFactory` providers can call it directly --
// Tasks 9/14 extend the body of each function with a real-adapter branch,
// gated on the presence of that provider's required env var. Nothing here
// ever reads a secret value, only checks whether one is present.

export function bindSmsProvider(): SmsProvider {
  if (!process.env.TWILIO_ACCOUNT_SID) return new NullSmsProvider();
  throw new Error('Twilio adapter not yet wired -- see Task 9');
}

export function bindVoiceProvider(): VoiceProvider {
  if (!process.env.TWILIO_ACCOUNT_SID) return new NullVoiceProvider();
  throw new Error('Twilio adapter not yet wired -- see Task 9');
}

export function bindEmailProvider(): EmailProvider {
  if (!process.env.RESEND_API_KEY) return new NullEmailProvider();
  throw new Error('Resend adapter not yet wired -- see Task 14');
}

export function bindInboundEmailProvider(): InboundEmailProvider {
  if (!process.env.RESEND_API_KEY) return new NullInboundEmailProvider();
  throw new Error('Resend adapter not yet wired -- see Task 14');
}

export function bindDeliveryStatusProvider(): DeliveryStatusProvider {
  if (!process.env.TWILIO_ACCOUNT_SID && !process.env.RESEND_API_KEY) {
    return new NullDeliveryStatusProvider();
  }
  throw new Error('Delivery status adapter not yet wired -- see Tasks 9/14');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest provider-binding.factory.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Create the module and register it**

`backend/src/modules/communications/communications.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  SMS_PROVIDER,
} from './interfaces/sms-provider.interface';
import { VOICE_PROVIDER } from './interfaces/voice-provider.interface';
import { EMAIL_PROVIDER } from './interfaces/email-provider.interface';
import { INBOUND_EMAIL_PROVIDER } from './interfaces/inbound-email-provider.interface';
import { DELIVERY_STATUS_PROVIDER } from './interfaces/delivery-status-provider.interface';
import {
  bindSmsProvider,
  bindVoiceProvider,
  bindEmailProvider,
  bindInboundEmailProvider,
  bindDeliveryStatusProvider,
} from './provider-binding.factory';

@Module({
  providers: [
    PrismaService,
    { provide: SMS_PROVIDER, useFactory: bindSmsProvider },
    { provide: VOICE_PROVIDER, useFactory: bindVoiceProvider },
    { provide: EMAIL_PROVIDER, useFactory: bindEmailProvider },
    { provide: INBOUND_EMAIL_PROVIDER, useFactory: bindInboundEmailProvider },
    {
      provide: DELIVERY_STATUS_PROVIDER,
      useFactory: bindDeliveryStatusProvider,
    },
  ],
  exports: [
    SMS_PROVIDER,
    VOICE_PROVIDER,
    EMAIL_PROVIDER,
    INBOUND_EMAIL_PROVIDER,
    DELIVERY_STATUS_PROVIDER,
  ],
})
export class CommunicationsModule {}
```

Add `import { CommunicationsModule } from './modules/communications/communications.module';` to `backend/src/app.module.ts` and add `CommunicationsModule` to the `imports` array (alongside `MarketingModule`).

- [ ] **Step 6: Confirm the app still builds with zero credentials**

```bash
cd backend && npx tsc --noEmit -p tsconfig.json
```
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/communications/communications.module.ts backend/src/modules/communications/provider-binding.factory.ts backend/src/modules/communications/provider-binding.factory.spec.ts backend/src/app.module.ts
git commit -m "feat(communications): wire CommunicationsModule with zero-credential-safe provider binding"
```

---

### Task 4.5: Raw-body middleware for Twilio/Resend webhook routes

**Why this task exists:** Twilio's HMAC signature and Resend's Svix signature are both computed over the **exact bytes** of the request body as originally sent. Nest's default global JSON body parser (`ValidationPipe`/`bodyParser.json()`) parses the body into a JS object before a controller ever sees it — reserializing that object with `JSON.stringify` (or reconstructing a form string from a parsed object) does **not** reliably reproduce the original bytes (key order, whitespace, form-encoding quirks all differ), which silently breaks signature verification. This is the exact same problem the existing `/webhooks/stripe` route already solved — `backend/src/main.ts:20` mounts `express.raw({ type: 'application/json' })` on that one route, ahead of the global JSON parser, so the controller gets the untouched raw `Buffer`. This task does the equivalent for the two new webhook route prefixes.

**Files:**
- Modify: `backend/src/main.ts`

**Interfaces:**
- Produces: `req.body` as a raw `Buffer` for any request under `/webhooks/twilio/*` and `/webhooks/resend/*` — Tasks 10, 11, and 14's controllers depend on this and must read `req.body.toString('utf-8')` (or `.toString()` for form-urlencoded) themselves rather than accepting an auto-parsed `@Body()` object.

- [ ] **Step 1: Read the existing Stripe raw-body line for the exact pattern**

```bash
cd backend && sed -n '15,25p' src/main.ts
```

- [ ] **Step 2: Add the two new raw-body mounts, in the same position (before `app.useGlobalPipes`)**

In `backend/src/main.ts`, immediately after the existing `app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));` line, add:

```typescript
  // Twilio signs the exact raw x-www-form-urlencoded bytes it sent -- same
  // reasoning as the Stripe webhook raw-body mount just above. Every route
  // under /webhooks/twilio needs the untouched Buffer, not Nest's parsed body.
  app.use(
    '/webhooks/twilio',
    express.raw({ type: 'application/x-www-form-urlencoded' }),
  );
  // Resend/Svix signs the exact raw JSON bytes -- same reasoning, JSON flavor.
  app.use('/webhooks/resend', express.raw({ type: 'application/json' }));
```

- [ ] **Step 3: Confirm the app still builds and boots locally**

```bash
cd backend && npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/main.ts
git commit -m "fix(communications): raw-body middleware for Twilio/Resend webhook signature verification"
```

---

### Task 5: ChannelConnectionService

**Files:**
- Create: `backend/src/modules/communications/channel-connection.service.ts`
- Test: `backend/src/modules/communications/channel-connection.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ChannelConnectionStatus`/`ChannelType`/`ChannelProvider` from `@prisma/client`.
- Produces: `ChannelConnectionService.getOrCreate(businessUnitId, workspaceId, type, provider)`, `.updateStatus(id, status)`, `.findActiveForBusinessUnit(businessUnitId, type)` — every later task that needs a `ChannelConnection` row calls these, not raw Prisma.

- [ ] **Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { ChannelConnectionService } from './channel-connection.service';
import { ChannelType, ChannelProvider, ChannelConnectionStatus } from '@prisma/client';

describe('ChannelConnectionService', () => {
  let service: ChannelConnectionService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ChannelConnectionService, PrismaService],
    }).compile();
    service = moduleRef.get(ChannelConnectionService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('getOrCreate is idempotent -- second call returns the same row, NOT_CONFIGURED by default', async () => {
    const org = await prisma.organization.create({ data: { name: 'CCT Org' } });
    const bu = await prisma.businessUnit.create({
      data: { name: 'CCT BU', key: 'CCT', organizationId: org.id },
    });
    const ws = await prisma.workspace.create({
      data: { name: 'CCT WS', subdomain: `cct-${Date.now()}`, organizationId: org.id, businessUnitId: bu.id },
    });

    const first = await service.getOrCreate(bu.id, ws.id, ChannelType.SMS, ChannelProvider.TWILIO);
    const second = await service.getOrCreate(bu.id, ws.id, ChannelType.SMS, ChannelProvider.TWILIO);

    expect(first.id).toBe(second.id);
    expect(first.status).toBe(ChannelConnectionStatus.NOT_CONFIGURED);

    await prisma.channelConnection.deleteMany({ where: { businessUnitId: bu.id } });
    await prisma.workspace.delete({ where: { id: ws.id } });
    await prisma.businessUnit.delete({ where: { id: bu.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest channel-connection.service.spec.ts
```
Expected: FAIL — service doesn't exist.

- [ ] **Step 3: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  ChannelType,
  ChannelProvider,
  ChannelConnectionStatus,
  ChannelConnection,
} from '@prisma/client';

@Injectable()
export class ChannelConnectionService {
  constructor(private prisma: PrismaService) {}

  async getOrCreate(
    businessUnitId: string,
    workspaceId: string,
    type: ChannelType,
    provider: ChannelProvider,
  ): Promise<ChannelConnection> {
    const existing = await this.prisma.channelConnection.findUnique({
      where: { businessUnitId_type_provider: { businessUnitId, type, provider } },
    });
    if (existing) return existing;

    return this.prisma.channelConnection.create({
      data: { businessUnitId, workspaceId, type, provider },
    });
  }

  async updateStatus(
    id: string,
    status: ChannelConnectionStatus,
  ): Promise<ChannelConnection> {
    return this.prisma.channelConnection.update({
      where: { id },
      data: { status, lastVerifiedAt: new Date() },
    });
  }

  async findActiveForBusinessUnit(
    businessUnitId: string,
    type: ChannelType,
  ): Promise<ChannelConnection | null> {
    return this.prisma.channelConnection.findFirst({
      where: { businessUnitId, type, status: ChannelConnectionStatus.ACTIVE },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest channel-connection.service.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Register in `CommunicationsModule` and commit**

Add `ChannelConnectionService` to the `providers` and `exports` arrays in `communications.module.ts`.

```bash
git add backend/src/modules/communications/channel-connection.service.ts backend/src/modules/communications/channel-connection.service.spec.ts backend/src/modules/communications/communications.module.ts
git commit -m "feat(communications): ChannelConnectionService"
```

---

### Task 6: CommunicationConsentService (opt-out enforcement)

**Files:**
- Create: `backend/src/modules/communications/communication-consent.service.ts`
- Test: `backend/src/modules/communications/communication-consent.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ConsentChannelType` from `@prisma/client`.
- Produces: `CommunicationConsentService.isOptedOut(contactId, channel): Promise<boolean>`, `.recordOptOut(contactId, channel, reason)`, `.recordOptIn(contactId, channel, reason)`, `.parseSmsKeyword(body: string): 'STOP' | 'START' | 'HELP' | null` — Task 7 (MessageService) and Task 11 (SMS inbound webhook) call these before any send and on every inbound SMS respectively.

- [ ] **Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { CommunicationConsentService } from './communication-consent.service';
import { ConsentChannelType } from '@prisma/client';

describe('CommunicationConsentService', () => {
  let service: CommunicationConsentService;
  let prisma: PrismaService;
  let contactId: string;
  let workspaceId: string;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CommunicationConsentService, PrismaService],
    }).compile();
    service = moduleRef.get(CommunicationConsentService);
    prisma = moduleRef.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: 'Consent Org' } });
    orgId = org.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Consent WS', subdomain: `consent-${Date.now()}`, organizationId: org.id },
    });
    workspaceId = ws.id;
    const contact = await prisma.contact.create({
      data: { firstName: 'Con', lastName: 'Sent', workspaceId: ws.id, emails: [], phones: [] },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.communicationConsent.deleteMany({ where: { contactId } });
    await prisma.contact.delete({ where: { id: contactId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('is not opted out by default', async () => {
    expect(await service.isOptedOut(contactId, ConsentChannelType.SMS)).toBe(false);
  });

  it('recordOptOut then isOptedOut returns true, recordOptIn reverses it', async () => {
    await service.recordOptOut(contactId, ConsentChannelType.SMS, 'STOP');
    expect(await service.isOptedOut(contactId, ConsentChannelType.SMS)).toBe(true);

    await service.recordOptIn(contactId, ConsentChannelType.SMS, 'START');
    expect(await service.isOptedOut(contactId, ConsentChannelType.SMS)).toBe(false);
  });

  it('parseSmsKeyword recognizes the standard TCPA keyword set case-insensitively', () => {
    expect(service.parseSmsKeyword('stop')).toBe('STOP');
    expect(service.parseSmsKeyword('STOPALL')).toBe('STOP');
    expect(service.parseSmsKeyword('Unsubscribe')).toBe('STOP');
    expect(service.parseSmsKeyword('start')).toBe('START');
    expect(service.parseSmsKeyword('unstop')).toBe('START');
    expect(service.parseSmsKeyword('help')).toBe('HELP');
    expect(service.parseSmsKeyword('hello there')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest communication-consent.service.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ConsentChannelType } from '@prisma/client';

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);
const HELP_KEYWORDS = new Set(['HELP', 'INFO']);

@Injectable()
export class CommunicationConsentService {
  constructor(private prisma: PrismaService) {}

  async isOptedOut(contactId: string, channel: ConsentChannelType): Promise<boolean> {
    const row = await this.prisma.communicationConsent.findUnique({
      where: { contactId_channel: { contactId, channel } },
    });
    return row?.optedOut ?? false;
  }

  async recordOptOut(
    contactId: string,
    channel: ConsentChannelType,
    reason: string,
  ): Promise<void> {
    await this.prisma.communicationConsent.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: { contactId, channel, optedOut: true, reason },
      update: { optedOut: true, reason },
    });
  }

  async recordOptIn(
    contactId: string,
    channel: ConsentChannelType,
    reason: string,
  ): Promise<void> {
    await this.prisma.communicationConsent.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: { contactId, channel, optedOut: false, reason },
      update: { optedOut: false, reason },
    });
  }

  parseSmsKeyword(body: string): 'STOP' | 'START' | 'HELP' | null {
    const normalized = body.trim().toUpperCase();
    if (STOP_KEYWORDS.has(normalized)) return 'STOP';
    if (START_KEYWORDS.has(normalized)) return 'START';
    if (HELP_KEYWORDS.has(normalized)) return 'HELP';
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest communication-consent.service.spec.ts
```
Expected: PASS, 3/3.

- [ ] **Step 5: Register and commit**

Add to `communications.module.ts` providers/exports.

```bash
git add backend/src/modules/communications/communication-consent.service.ts backend/src/modules/communications/communication-consent.service.spec.ts backend/src/modules/communications/communications.module.ts
git commit -m "feat(communications): CommunicationConsentService with TCPA keyword parsing"
```

---

### Task 7: ConversationService (find-or-create + reply token threading)

**Files:**
- Create: `backend/src/modules/communications/conversation.service.ts`
- Test: `backend/src/modules/communications/conversation.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ConversationChannel` from `@prisma/client`, `crypto.randomBytes`.
- Produces: `ConversationService.findOrCreate(params: { workspaceId, businessUnitId, channelConnectionId, channel, counterpartyAddress, contactId?, clientAccountId? })`, `.findByReplyToken(token: string)`, `.touchLastMessageAt(conversationId, at: Date)`.

- [ ] **Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { ConversationService } from './conversation.service';
import { ChannelType, ChannelProvider, ConversationChannel } from '@prisma/client';

describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: PrismaService;
  let workspaceId: string;
  let businessUnitId: string;
  let orgId: string;
  let channelConnectionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ConversationService, PrismaService],
    }).compile();
    service = moduleRef.get(ConversationService);
    prisma = moduleRef.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: 'Conv Org' } });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({
      data: { name: 'Conv BU', key: 'CONV', organizationId: org.id },
    });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Conv WS', subdomain: `conv-${Date.now()}`, organizationId: org.id, businessUnitId: bu.id },
    });
    workspaceId = ws.id;
    const conn = await prisma.channelConnection.create({
      data: { workspaceId: ws.id, businessUnitId: bu.id, type: ChannelType.SMS, provider: ChannelProvider.TWILIO },
    });
    channelConnectionId = conn.id;
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { workspaceId } });
    await prisma.channelConnection.deleteMany({ where: { businessUnitId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('findOrCreate is idempotent per (channelConnection, counterpartyAddress)', async () => {
    const first = await service.findOrCreate({
      workspaceId,
      businessUnitId,
      channelConnectionId,
      channel: ConversationChannel.SMS,
      counterpartyAddress: '+15555550100',
    });
    const second = await service.findOrCreate({
      workspaceId,
      businessUnitId,
      channelConnectionId,
      channel: ConversationChannel.SMS,
      counterpartyAddress: '+15555550100',
    });
    expect(first.id).toBe(second.id);
  });

  it('EMAIL conversations get a unique replyToken resolvable via findByReplyToken', async () => {
    const emailConn = await prisma.channelConnection.create({
      data: { workspaceId, businessUnitId, type: 'EMAIL', provider: 'RESEND' },
    });
    const convo = await service.findOrCreate({
      workspaceId,
      businessUnitId,
      channelConnectionId: emailConn.id,
      channel: ConversationChannel.EMAIL,
      counterpartyAddress: 'lead@example.com',
    });
    expect(convo.replyToken).toBeTruthy();

    const resolved = await service.findByReplyToken(convo.replyToken as string);
    expect(resolved?.id).toBe(convo.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest conversation.service.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { Conversation, ConversationChannel } from '@prisma/client';

@Injectable()
export class ConversationService {
  constructor(private prisma: PrismaService) {}

  async findOrCreate(params: {
    workspaceId: string;
    businessUnitId: string;
    channelConnectionId: string;
    channel: ConversationChannel;
    counterpartyAddress: string;
    contactId?: string;
    clientAccountId?: string;
  }): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        channelConnectionId_counterpartyAddress: {
          channelConnectionId: params.channelConnectionId,
          counterpartyAddress: params.counterpartyAddress,
        },
      },
    });
    if (existing) return existing;

    const replyToken =
      params.channel === 'EMAIL' ? randomBytes(16).toString('hex') : null;

    return this.prisma.conversation.create({
      data: {
        workspaceId: params.workspaceId,
        businessUnitId: params.businessUnitId,
        channelConnectionId: params.channelConnectionId,
        channel: params.channel,
        counterpartyAddress: params.counterpartyAddress,
        contactId: params.contactId,
        clientAccountId: params.clientAccountId,
        replyToken,
      },
    });
  }

  async findByReplyToken(token: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({ where: { replyToken: token } });
  }

  async touchLastMessageAt(conversationId: string, at: Date): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: at },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest conversation.service.spec.ts
```
Expected: PASS, 2/2.

- [ ] **Step 5: Register and commit**

```bash
git add backend/src/modules/communications/conversation.service.ts backend/src/modules/communications/conversation.service.spec.ts backend/src/modules/communications/communications.module.ts
git commit -m "feat(communications): ConversationService with reply-token threading"
```

---

### Task 8: MessageService (consent-gated send + message recording)

**Files:**
- Create: `backend/src/modules/communications/message.service.ts`
- Test: `backend/src/modules/communications/message.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `CommunicationConsentService` (Task 6), `ConversationService` (Task 7), `SmsProvider`/`EmailProvider` via `SMS_PROVIDER`/`EMAIL_PROVIDER` tokens (Task 2/4).
- Produces: `MessageService.sendSms(params)`, `.sendEmail(params)`, `.recordInboundSms(params)`, `.recordInboundEmail(params)` — Tasks 10/11/15/16 (controllers) call these, never touch `SmsProvider`/`EmailProvider` or Prisma `message` directly.

- [ ] **Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { CommunicationConsentService } from './communication-consent.service';
import { SMS_PROVIDER } from '../interfaces/sms-provider.interface';
import { EMAIL_PROVIDER } from '../interfaces/email-provider.interface';
import { ChannelType, ChannelProvider, ConversationChannel, ConsentChannelType } from '@prisma/client';

describe('MessageService', () => {
  let service: MessageService;
  let prisma: PrismaService;
  let consent: CommunicationConsentService;
  let workspaceId: string;
  let businessUnitId: string;
  let orgId: string;
  let contactId: string;
  let channelConnectionId: string;
  const fakeSmsProvider = {
    sendSms: jest.fn().mockResolvedValue({ providerMessageId: 'SMfake123' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessageService,
        ConversationService,
        CommunicationConsentService,
        PrismaService,
        { provide: SMS_PROVIDER, useValue: fakeSmsProvider },
        { provide: EMAIL_PROVIDER, useValue: { sendEmail: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(MessageService);
    prisma = moduleRef.get(PrismaService);
    consent = moduleRef.get(CommunicationConsentService);

    const org = await prisma.organization.create({ data: { name: 'Msg Org' } });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({ data: { name: 'Msg BU', key: 'MSG', organizationId: org.id } });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Msg WS', subdomain: `msg-${Date.now()}`, organizationId: org.id, businessUnitId: bu.id },
    });
    workspaceId = ws.id;
    const contact = await prisma.contact.create({
      data: { firstName: 'M', lastName: 'Sg', workspaceId: ws.id, emails: [], phones: ['+15555550199'] },
    });
    contactId = contact.id;
    const conn = await prisma.channelConnection.create({
      data: { workspaceId: ws.id, businessUnitId: bu.id, type: ChannelType.SMS, provider: ChannelProvider.TWILIO },
    });
    channelConnectionId = conn.id;
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { conversation: { workspaceId } } });
    await prisma.conversation.deleteMany({ where: { workspaceId } });
    await prisma.communicationConsent.deleteMany({ where: { contactId } });
    await prisma.contact.delete({ where: { id: contactId } });
    await prisma.channelConnection.deleteMany({ where: { businessUnitId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('sendSms creates a SENT Message with the provider message id when consent allows', async () => {
    const message = await service.sendSms({
      workspaceId,
      businessUnitId,
      channelConnectionId,
      contactId,
      to: '+15555550199',
      from: '+15555550100',
      body: 'Hello from DEMM',
    });
    expect(message.status).toBe('SENT');
    expect(message.providerMessageId).toBe('SMfake123');
    expect(fakeSmsProvider.sendSms).toHaveBeenCalled();
  });

  it('sendSms throws and does NOT call the provider when the contact opted out', async () => {
    await consent.recordOptOut(contactId, ConsentChannelType.SMS, 'STOP');
    fakeSmsProvider.sendSms.mockClear();

    await expect(
      service.sendSms({
        workspaceId,
        businessUnitId,
        channelConnectionId,
        contactId,
        to: '+15555550199',
        from: '+15555550100',
        body: 'Should be blocked',
      }),
    ).rejects.toThrow(/opted out/i);
    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest message.service.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ConversationService } from './conversation.service';
import { CommunicationConsentService } from './communication-consent.service';
import { SMS_PROVIDER, SmsProvider } from '../interfaces/sms-provider.interface';
import { EMAIL_PROVIDER, EmailProvider } from '../interfaces/email-provider.interface';
import { Message, ConsentChannelType } from '@prisma/client';

@Injectable()
export class MessageService {
  constructor(
    private prisma: PrismaService,
    private conversations: ConversationService,
    private consent: CommunicationConsentService,
    @Inject(SMS_PROVIDER) private smsProvider: SmsProvider,
    @Inject(EMAIL_PROVIDER) private emailProvider: EmailProvider,
  ) {}

  async sendSms(params: {
    workspaceId: string;
    businessUnitId: string;
    channelConnectionId: string;
    contactId?: string;
    to: string;
    from: string;
    body: string;
    sentByUserId?: string;
    templateId?: string;
  }): Promise<Message> {
    if (params.contactId) {
      const optedOut = await this.consent.isOptedOut(
        params.contactId,
        ConsentChannelType.SMS,
      );
      if (optedOut) {
        throw new ForbiddenException(
          'Contact has opted out of SMS -- message not sent.',
        );
      }
    }

    const conversation = await this.conversations.findOrCreate({
      workspaceId: params.workspaceId,
      businessUnitId: params.businessUnitId,
      channelConnectionId: params.channelConnectionId,
      channel: 'SMS',
      counterpartyAddress: params.to,
      contactId: params.contactId,
    });

    const { providerMessageId } = await this.smsProvider.sendSms({
      to: params.to,
      from: params.from,
      body: params.body,
      statusCallbackUrl: process.env.BACKEND_PUBLIC_URL
        ? `${process.env.BACKEND_PUBLIC_URL}/webhooks/twilio/sms-status`
        : undefined,
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        status: 'SENT',
        body: params.body,
        providerMessageId,
        sentByUserId: params.sentByUserId,
        templateId: params.templateId,
      },
    });

    await this.conversations.touchLastMessageAt(conversation.id, message.createdAt);
    return message;
  }

  async sendEmail(params: {
    workspaceId: string;
    businessUnitId: string;
    channelConnectionId: string;
    contactId?: string;
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    sentByUserId?: string;
    templateId?: string;
  }): Promise<Message> {
    if (params.contactId) {
      const optedOut = await this.consent.isOptedOut(
        params.contactId,
        ConsentChannelType.EMAIL,
      );
      if (optedOut) {
        throw new ForbiddenException(
          'Contact has opted out of email -- message not sent.',
        );
      }
    }

    const conversation = await this.conversations.findOrCreate({
      workspaceId: params.workspaceId,
      businessUnitId: params.businessUnitId,
      channelConnectionId: params.channelConnectionId,
      channel: 'EMAIL',
      counterpartyAddress: params.to,
      contactId: params.contactId,
    });

    const { providerMessageId } = await this.emailProvider.sendEmail({
      to: params.to,
      from: params.from,
      replyTo: params.replyTo,
      subject: params.subject,
      html: params.html,
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        status: 'SENT',
        body: params.html,
        providerMessageId,
        sentByUserId: params.sentByUserId,
        templateId: params.templateId,
      },
    });

    await this.conversations.touchLastMessageAt(conversation.id, message.createdAt);
    return message;
  }

  async recordInboundSms(params: {
    conversationId: string;
    providerMessageId: string;
    body: string;
  }): Promise<Message | null> {
    const existing = await this.prisma.message.findUnique({
      where: { providerMessageId: params.providerMessageId },
    });
    if (existing) return null; // duplicate webhook delivery -- idempotent no-op

    const message = await this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body: params.body,
        providerMessageId: params.providerMessageId,
      },
    });
    await this.conversations.touchLastMessageAt(params.conversationId, message.createdAt);
    return message;
  }

  async recordInboundEmail(params: {
    conversationId: string;
    providerMessageId: string;
    html: string | null;
  }): Promise<Message | null> {
    const existing = await this.prisma.message.findUnique({
      where: { providerMessageId: params.providerMessageId },
    });
    if (existing) return null;

    const message = await this.prisma.message.create({
      data: {
        conversationId: params.conversationId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body: params.html,
        providerMessageId: params.providerMessageId,
      },
    });
    await this.conversations.touchLastMessageAt(params.conversationId, message.createdAt);
    return message;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest message.service.spec.ts
```
Expected: PASS, 2/2.

- [ ] **Step 5: Register and commit**

```bash
git add backend/src/modules/communications/message.service.ts backend/src/modules/communications/message.service.spec.ts backend/src/modules/communications/communications.module.ts
git commit -m "feat(communications): MessageService enforcing consent before send, idempotent inbound recording"
```

---

### Task 9: TwilioAdapter (SmsProvider + VoiceProvider + DeliveryStatusProvider)

**Files:**
- Create: `backend/src/modules/communications/providers/twilio-adapter.ts`
- Modify: `backend/src/modules/communications/provider-binding.factory.ts` (real Twilio branch)
- Modify: `backend/package.json` (add `twilio` dependency)
- Test: `backend/src/modules/communications/providers/twilio-adapter.spec.ts`

**Interfaces:**
- Consumes: `SmsProvider`, `VoiceProvider`, `DeliveryStatusProvider` from Task 2. `twilio` npm SDK's `validateRequest` function for signature verification (this is what makes Stage 2's signed-fixture test meaningful — it's the real Twilio verification algorithm, not a reimplementation).
- Produces: `TwilioAdapter` class, used by Task 4's binding factory and Tasks 10-13's controllers via the same `SMS_PROVIDER`/`VOICE_PROVIDER`/`DELIVERY_STATUS_PROVIDER` tokens Task 8 already depends on — no calling code changes when this task lands.

- [ ] **Step 1: Add the `twilio` dependency**

```bash
cd backend && npm install twilio
```

- [ ] **Step 2: Write the failing test (signature verification against Twilio's own algorithm, no network call)**

```typescript
import { TwilioAdapter } from './twilio-adapter';
import { validateRequest } from 'twilio';

describe('TwilioAdapter', () => {
  const authToken = 'test_auth_token_1234567890';
  let adapter: TwilioAdapter;

  beforeAll(() => {
    adapter = new TwilioAdapter({
      accountSid: 'ACtest',
      authToken,
      fromNumber: '+15555550100',
    });
  });

  it('verifyInboundWebhookSignature accepts a genuinely-signed payload', () => {
    const url = 'https://staging.example.com/webhooks/twilio/sms';
    const params = { From: '+15555550199', To: '+15555550100', Body: 'hi' };
    // Twilio signs application/x-www-form-urlencoded params, not raw JSON --
    // build the same signature the real Twilio infrastructure would send.
    const crypto = require('crypto');
    const data = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + (params as any)[key], url);
    const signature = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');

    expect(
      adapter.verifyInboundWebhookSignature(
        new URLSearchParams(params).toString(),
        signature,
        url,
      ),
    ).toBe(true);
  });

  it('verifyInboundWebhookSignature rejects a tampered payload', () => {
    const url = 'https://staging.example.com/webhooks/twilio/sms';
    expect(
      adapter.verifyInboundWebhookSignature(
        'From=%2B15555550199&Body=tampered',
        'not-a-real-signature==',
        url,
      ),
    ).toBe(false);
  });

  it('parseInboundSms extracts providerMessageId/from/to/body from Twilio form fields', () => {
    const parsed = adapter.parseInboundSms({
      MessageSid: 'SM123abc',
      From: '+15555550199',
      To: '+15555550100',
      Body: 'Hello',
    });
    expect(parsed).toEqual({
      providerMessageId: 'SM123abc',
      from: '+15555550199',
      to: '+15555550100',
      body: 'Hello',
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend && npx jest twilio-adapter.spec.ts
```
Expected: FAIL — adapter doesn't exist.

- [ ] **Step 4: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import Twilio, { validateRequest } from 'twilio';
import { SmsProvider, InboundSmsPayload } from '../interfaces/sms-provider.interface';
import { VoiceProvider, VoiceStatusPayload } from '../interfaces/voice-provider.interface';
import {
  DeliveryStatusProvider,
  ProviderName,
} from '../interfaces/delivery-status-provider.interface';
import { DeliveryAttemptOutcome } from '@prisma/client';

// Twilio's own CallStatus/MessageStatus values that count as terminal --
// anything else (queued/ringing/in-progress) is not a final outcome yet
// and must never be written to CallEvent.outcome (see Task 12's out-of-
// order guard, which relies on only terminal statuses reaching it).
const TWILIO_MESSAGE_STATUS_TO_OUTCOME: Record<string, DeliveryAttemptOutcome> = {
  delivered: 'SUCCEEDED',
  sent: 'SUCCEEDED',
  failed: 'FAILED',
  undelivered: 'UNDELIVERED',
};

@Injectable()
export class TwilioAdapter implements SmsProvider, VoiceProvider, DeliveryStatusProvider {
  private client: ReturnType<typeof Twilio>;

  constructor(
    private config: { accountSid: string; authToken: string; fromNumber: string },
  ) {
    this.client = Twilio(config.accountSid, config.authToken);
  }

  async sendSms(params: {
    to: string;
    from: string;
    body: string;
    statusCallbackUrl?: string;
  }): Promise<{ providerMessageId: string }> {
    const result = await this.client.messages.create({
      to: params.to,
      from: params.from,
      body: params.body,
      ...(params.statusCallbackUrl ? { statusCallback: params.statusCallbackUrl } : {}),
    });
    return { providerMessageId: result.sid };
  }

  verifyInboundWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    url: string,
  ): boolean {
    const params = Object.fromEntries(new URLSearchParams(rawBody));
    return validateRequest(this.config.authToken, signatureHeader, url, params);
  }

  parseInboundSms(rawBody: Record<string, unknown>): InboundSmsPayload {
    return {
      providerMessageId: rawBody.MessageSid as string,
      from: rawBody.From as string,
      to: rawBody.To as string,
      body: rawBody.Body as string,
    };
  }

  parseVoiceStatusCallback(rawBody: Record<string, unknown>): VoiceStatusPayload {
    return {
      providerCallId: rawBody.CallSid as string,
      from: rawBody.From as string,
      to: rawBody.To as string,
      callStatus: rawBody.CallStatus as string,
      timestamp: new Date(),
      answeredByMachine: rawBody.AnsweredBy === 'machine_start' || rawBody.AnsweredBy === 'machine_end_beep',
    };
  }

  normalizeStatus(providerName: ProviderName, rawEvent: Record<string, unknown>): DeliveryAttemptOutcome {
    if (providerName !== 'TWILIO') {
      throw new Error(`TwilioAdapter cannot normalize ${providerName} events`);
    }
    const status = (rawEvent.MessageStatus as string) ?? '';
    return TWILIO_MESSAGE_STATUS_TO_OUTCOME[status] ?? 'FAILED';
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && npx jest twilio-adapter.spec.ts
```
Expected: PASS, 3/3.

- [ ] **Step 6: Wire the real branch into the binding factory**

In `provider-binding.factory.ts`, replace the `bindSmsProvider`/`bindVoiceProvider`/`bindDeliveryStatusProvider` Twilio branches:

```typescript
import { TwilioAdapter } from './providers/twilio-adapter';

// ... inside bindSmsProvider():
if (!process.env.TWILIO_ACCOUNT_SID) return new NullSmsProvider();
return new TwilioAdapter({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  fromNumber: process.env.TWILIO_FROM_NUMBER!,
});
```
(Apply the equivalent real-branch swap to `bindVoiceProvider` and the Twilio half of `bindDeliveryStatusProvider`, reusing the same `TwilioAdapter` instance shape.)

- [ ] **Step 7: Confirm build still succeeds with zero credentials (NullSmsProvider path untouched)**

```bash
cd backend && npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/modules/communications/providers/twilio-adapter.ts backend/src/modules/communications/providers/twilio-adapter.spec.ts backend/src/modules/communications/provider-binding.factory.ts
git commit -m "feat(communications): TwilioAdapter implementing SmsProvider/VoiceProvider/DeliveryStatusProvider"
```

---

### Task 10: SMS outbound + inbound webhook controller

**Files:**
- Create: `backend/src/modules/communications/sms.controller.ts`
- Test: `backend/test-communications-sms-api.ts` (HTTP-level, boots real Nest app — same established pattern as `backend/test-stripe-billing-api.ts`)

**Interfaces:**
- Consumes: `MessageService` (Task 8), `ChannelConnectionService` (Task 5), `SMS_PROVIDER` token for signature verification, `JwtAuthGuard`/`WorkspaceGuard`/`BusinessUnitGuard`/`CurrentUser`, Task 4.5's raw-body middleware (`req.body` is a `Buffer` on every route in this controller, not a parsed object).
- Produces: `POST /marketing/clients/:id/communications/sms` (operator-initiated outbound), `POST /webhooks/twilio/sms` (inbound, no auth guard -- Twilio can't present a JWT, signature verification is the auth), `POST /webhooks/twilio/sms-status` (outbound delivery-status callback: delivered/failed/undelivered, written as `DeliveryAttempt` rows).

- [ ] **Step 1: Write the failing HTTP-level test**

`backend/test-communications-sms-api.ts` (follow the exact bootstrap pattern already used in `backend/test-stripe-billing-api.ts` -- real `NestFactory.create(AppModule)`, real HTTP calls via `supertest` or raw `fetch` against the booted app):

```typescript
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma.service';

let passed = 0;
let failed = 0;
function check(condition: boolean, description: string) {
  if (condition) {
    passed++;
    console.log(`✅ ${description}`);
  } else {
    failed++;
    console.error(`❌ ${description}`);
  }
}

async function run() {
  const app = await NestFactory.create(AppModule);
  await app.init();
  const prisma = app.get(PrismaService);
  const server = app.getHttpServer();

  // ... seed org/BU/workspace/user/contact/channelConnection following the
  // exact fixture pattern in test-stripe-billing-api.ts, obtain a JWT via
  // the real /api/auth/login flow, then:

  // 1. Outbound SMS with no ChannelConnection ACTIVE -> expect 503 / clear
  //    "not connected" error, NOT a fabricated success.
  // 2. Inbound webhook with a garbage signature -> expect 401, and assert
  //    zero Message rows were created (query BillingPaymentRecord-style
  //    via prisma directly).
  // 3. Inbound webhook with a validly-signed payload (construct the
  //    signature the same way Task 9's adapter spec does, using a real
  //    TWILIO_AUTH_TOKEN test value) containing "STOP" -> expect
  //    CommunicationConsent row created with optedOut: true.
  // 4. Redeliver the exact same signed inbound webhook payload a second
  //    time -> expect no duplicate Message row (providerMessageId unique
  //    constraint honored, same idempotency discipline as
  //    BillingPaymentRecord.stripeInvoiceId in the Stripe sub-project).
  // 5. A signed sms-status callback with MessageStatus=delivered for a
  //    known providerMessageId -> a new DeliveryAttempt(outcome:SUCCEEDED)
  //    row and Message.status flips to DELIVERED.
  // 6. The same signed sms-status callback redelivered -> a SECOND
  //    DeliveryAttempt row is expected (append-only log, not deduped --
  //    unlike Message, DeliveryAttempt intentionally has no uniqueness
  //    constraint since Twilio may legitimately redeliver the same status
  //    plus send genuinely new ones; assert count grows, not that it's
  //    rejected).

  await app.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
```

(This step's full fixture/assertion bodies are written directly against Task 5-8's exact service signatures once this task starts — the shape above is the contract the implementer fills in verbatim, matching `test-stripe-billing-api.ts`'s established structure line-for-line.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx ts-node -T test-communications-sms-api.ts
```
Expected: FAIL — controller/routes don't exist (connection refused / 404).

- [ ] **Step 3: Implement the controller**

```typescript
import {
  Controller,
  Post,
  Body,
  Param,
  Headers,
  Req,
  UseGuards,
  HttpCode,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { MessageService } from './message.service';
import { ChannelConnectionService } from './channel-connection.service';
import { CommunicationConsentService } from './communication-consent.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SMS_PROVIDER, SmsProvider } from '../interfaces/sms-provider.interface';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ChannelType, ChannelProvider, ConsentChannelType } from '@prisma/client';

@Controller('marketing/clients/:id/communications')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class SmsOutboundController {
  constructor(
    private messages: MessageService,
    private channels: ChannelConnectionService,
    private prisma: PrismaService,
  ) {}

  @Post('sms')
  async sendSms(
    @Param('id') clientAccountId: string,
    @Body('body') body: string,
    @Req() req: Request & { workspaceId: string },
    @CurrentUser() user: { id: string; businessUnitId: string },
  ) {
    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      include: { primaryContact: true },
    });
    if (!clientAccount) throw new UnauthorizedException('Client not found in scope');

    const connection = await this.channels.findActiveForBusinessUnit(
      clientAccount.businessUnitId,
      ChannelType.SMS,
    );
    if (!connection?.externalAddress) {
      throw new ServiceUnavailableException(
        'SMS channel is not connected for this Business Unit yet.',
      );
    }

    const toNumber = clientAccount.primaryContact.phones[0];
    return this.messages.sendSms({
      workspaceId: req.workspaceId,
      businessUnitId: clientAccount.businessUnitId,
      channelConnectionId: connection.id,
      contactId: clientAccount.primaryContactId,
      to: toNumber,
      from: connection.externalAddress,
      body,
      sentByUserId: user.id,
    });
  }
}

@Controller('webhooks/twilio')
export class TwilioSmsWebhookController {
  constructor(
    private messages: MessageService,
    private consent: CommunicationConsentService,
    private prisma: PrismaService,
    @Inject(SMS_PROVIDER) private smsProvider: SmsProvider,
  ) {}

  // NOTE: because of Task 4.5's raw-body middleware, `req.body` here is a
  // Buffer, NOT a parsed object -- do not use a `@Body()` DTO decorator on
  // any method in this controller. Parse the form body yourself, AFTER
  // signature verification has run against the untouched raw bytes.
  @Post('sms')
  @HttpCode(200)
  async handleInboundSms(
    @Headers('x-twilio-signature') signature: string,
    @Req() req: Request,
  ) {
    const rawFormBody = (req.body as Buffer).toString('utf-8');
    const url = `${process.env.BACKEND_PUBLIC_URL}${req.originalUrl}`;
    if (!this.smsProvider.verifyInboundWebhookSignature(rawFormBody, signature, url)) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    const parsedForm = Object.fromEntries(new URLSearchParams(rawFormBody));
    const payload = this.smsProvider.parseInboundSms(parsedForm);

    const connection = await this.prisma.channelConnection.findFirst({
      where: { externalAddress: payload.to, type: 'SMS' },
    });
    if (!connection) throw new UnauthorizedException('Unknown destination number');

    const contact = await this.prisma.contact.findFirst({
      where: { workspaceId: connection.workspaceId, phones: { has: payload.from } },
    });

    const conversation = await this.prisma.conversation.upsert({
      where: {
        channelConnectionId_counterpartyAddress: {
          channelConnectionId: connection.id,
          counterpartyAddress: payload.from,
        },
      },
      create: {
        workspaceId: connection.workspaceId,
        businessUnitId: connection.businessUnitId,
        channelConnectionId: connection.id,
        channel: 'SMS',
        counterpartyAddress: payload.from,
        contactId: contact?.id,
      },
      update: {},
    });

    await this.messages.recordInboundSms({
      conversationId: conversation.id,
      providerMessageId: payload.providerMessageId,
      body: payload.body,
    });

    if (contact) {
      const keyword = this.consent.parseSmsKeyword(payload.body);
      if (keyword === 'STOP') {
        await this.consent.recordOptOut(contact.id, ConsentChannelType.SMS, 'STOP');
      } else if (keyword === 'START') {
        await this.consent.recordOptIn(contact.id, ConsentChannelType.SMS, 'START');
      }
    }

    return { received: true };
  }

  // Twilio's outbound SMS status callback (registered as the
  // StatusCallback URL on every message.create call) -- delivered,
  // failed, undelivered. Appended as a new DeliveryAttempt row per
  // callback rather than mutating a single field, so redelivery/reordering
  // never needs a special guard (append-only is inherently safe here,
  // unlike CallEvent.outcome in Task 11 which DOES need one).
  @Post('sms-status')
  @HttpCode(200)
  async handleSmsStatus(
    @Headers('x-twilio-signature') signature: string,
    @Req() req: Request,
  ) {
    const rawFormBody = (req.body as Buffer).toString('utf-8');
    const url = `${process.env.BACKEND_PUBLIC_URL}${req.originalUrl}`;
    if (!this.smsProvider.verifyInboundWebhookSignature(rawFormBody, signature, url)) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    const parsedForm = Object.fromEntries(new URLSearchParams(rawFormBody));
    const providerMessageId = parsedForm.MessageSid;

    const message = await this.prisma.message.findUnique({
      where: { providerMessageId },
    });
    if (!message) return { received: true }; // status for a message we don't track (e.g. pre-integration) -- ack, no-op

    const status = parsedForm.MessageStatus;
    const outcomeMap: Record<string, 'SUCCEEDED' | 'FAILED' | 'UNDELIVERED'> = {
      delivered: 'SUCCEEDED',
      sent: 'SUCCEEDED',
      failed: 'FAILED',
      undelivered: 'UNDELIVERED',
    };
    const outcome = outcomeMap[status];
    if (!outcome) return { received: true }; // queued/sending -- not terminal, nothing to record yet

    await this.prisma.deliveryAttempt.create({
      data: {
        messageId: message.id,
        outcome,
        providerCode: parsedForm.ErrorCode || null,
        providerRaw: parsedForm as any,
        occurredAt: new Date(),
      },
    });

    await this.prisma.message.update({
      where: { id: message.id },
      data: { status: outcome === 'SUCCEEDED' ? 'DELIVERED' : (outcome as any) },
    });

    return { received: true };
  }
}
```

- [ ] **Step 4: Register both controllers in `communications.module.ts`**

Add `SmsOutboundController` and `TwilioSmsWebhookController` to the `controllers` array.

- [ ] **Step 5: Fill in the test fixtures/assertions and run to verify it passes**

```bash
cd backend && npx ts-node -T test-communications-sms-api.ts
```
Expected: all checks pass (exact count depends on the fixture set written in Step 1/5, minimum the 4 scenarios listed).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/communications/sms.controller.ts backend/src/modules/communications/communications.module.ts backend/test-communications-sms-api.ts
git commit -m "feat(communications): SMS outbound endpoint + signature-verified inbound webhook with STOP/START handling"
```

---

### Task 11: CallEvent state machine + missed-call text-back

**Files:**
- Create: `backend/src/modules/communications/call-event.service.ts`
- Create: `backend/src/modules/communications/voice.controller.ts`
- Test: `backend/src/modules/communications/call-event.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `MessageService.sendSms` (Task 8), `MessageTemplate` model (Task 13 defines the service; this task can query the model directly for the missed-call template by `(businessUnitId, channel: SMS, name: 'missed-call-textback')` since Task 13 hasn't run yet in dependency order — see note below), Task 4.5's raw-body middleware (`voice.controller.ts`'s `req.body` is a `Buffer`).
- Produces: `CallEventService.recordStatusCallback(payload: VoiceStatusPayload, connection)`, which is the single entry point `voice.controller.ts` calls; internally decides terminal-vs-not, out-of-order guard, missed-call classification, cooldown check, and text-back trigger.

**Note on ordering:** this task queries `MessageTemplate` by name directly via Prisma (not through a `MessageTemplateService`, which doesn't exist until Task 13) — this is intentional and matches YAGNI: a full template-resolution service isn't needed for one hardcoded lookup key. Task 13 building the general-purpose `MessageTemplateService` later does not require refactoring this task.

- [ ] **Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { CallEventService } from './call-event.service';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { CommunicationConsentService } from './communication-consent.service';
import { SMS_PROVIDER } from '../interfaces/sms-provider.interface';
import { EMAIL_PROVIDER } from '../interfaces/email-provider.interface';
import { ChannelType, ChannelProvider } from '@prisma/client';

describe('CallEventService', () => {
  let service: CallEventService;
  let prisma: PrismaService;
  let workspaceId: string;
  let businessUnitId: string;
  let orgId: string;
  let channelConnectionId: string;
  const fakeSmsProvider = { sendSms: jest.fn().mockResolvedValue({ providerMessageId: 'SMtextback' }) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CallEventService,
        MessageService,
        ConversationService,
        CommunicationConsentService,
        PrismaService,
        { provide: SMS_PROVIDER, useValue: fakeSmsProvider },
        { provide: EMAIL_PROVIDER, useValue: { sendEmail: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CallEventService);
    prisma = moduleRef.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: 'Call Org' } });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({ data: { name: 'Call BU', key: 'CALL', organizationId: org.id } });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Call WS', subdomain: `call-${Date.now()}`, organizationId: org.id, businessUnitId: bu.id },
    });
    workspaceId = ws.id;
    const conn = await prisma.channelConnection.create({
      data: { workspaceId: ws.id, businessUnitId: bu.id, type: ChannelType.VOICE, provider: ChannelProvider.TWILIO, externalAddress: '+15555550100' },
    });
    channelConnectionId = conn.id;
    await prisma.channelConnection.update({ where: { id: conn.id }, data: { status: 'ACTIVE' } });
    // Also create the matching SMS connection the text-back send uses.
    await prisma.channelConnection.create({
      data: { workspaceId: ws.id, businessUnitId: bu.id, type: ChannelType.SMS, provider: ChannelProvider.TWILIO, externalAddress: '+15555550100', status: 'ACTIVE' },
    });
    await prisma.messageTemplate.create({
      data: { workspaceId: ws.id, businessUnitId: bu.id, channel: 'SMS', name: 'missed-call-textback', body: 'Sorry we missed your call! How can we help?' },
    });
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { conversation: { workspaceId } } });
    await prisma.conversation.deleteMany({ where: { workspaceId } });
    await prisma.callEvent.deleteMany({ where: { workspaceId } });
    await prisma.messageTemplate.deleteMany({ where: { workspaceId } });
    await prisma.channelConnection.deleteMany({ where: { businessUnitId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('a non-terminal status (ringing) does not set outcome or trigger text-back', async () => {
    await service.recordStatusCallback(
      { providerCallId: 'CAringing1', from: '+15555559999', to: '+15555550100', callStatus: 'ringing', timestamp: new Date() },
      channelConnectionId,
    );
    const event = await prisma.callEvent.findUnique({ where: { providerCallId: 'CAringing1' } });
    expect(event?.outcome).toBeNull();
    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
  });

  it('a terminal no-answer status sets outcome and fires exactly one text-back', async () => {
    await service.recordStatusCallback(
      { providerCallId: 'CAnoanswer1', from: '+15555558888', to: '+15555550100', callStatus: 'no-answer', timestamp: new Date() },
      channelConnectionId,
    );
    const event = await prisma.callEvent.findUnique({ where: { providerCallId: 'CAnoanswer1' } });
    expect(event?.outcome).toBe('NO_ANSWER');
    expect(event?.textBackSent).toBe(true);
    expect(fakeSmsProvider.sendSms).toHaveBeenCalledTimes(1);
  });

  it('a second missed call from the same number within the cooldown window does NOT re-fire text-back', async () => {
    fakeSmsProvider.sendSms.mockClear();
    await service.recordStatusCallback(
      { providerCallId: 'CAnoanswer2', from: '+15555558888', to: '+15555550100', callStatus: 'busy', timestamp: new Date() },
      channelConnectionId,
    );
    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
    const event = await prisma.callEvent.findUnique({ where: { providerCallId: 'CAnoanswer2' } });
    expect(event?.outcome).toBe('BUSY');
    expect(event?.textBackSent).toBe(false);
  });

  it('FAILED outcome never triggers a text-back', async () => {
    fakeSmsProvider.sendSms.mockClear();
    await service.recordStatusCallback(
      { providerCallId: 'CAfailed1', from: '+15555557777', to: '+15555550100', callStatus: 'failed', timestamp: new Date() },
      channelConnectionId,
    );
    expect(fakeSmsProvider.sendSms).not.toHaveBeenCalled();
  });

  it('an out-of-order stale terminal callback does not revert a fresher outcome', async () => {
    const laterCallback = { providerCallId: 'CAordering1', from: '+15555556666', to: '+15555550100', callStatus: 'completed', timestamp: new Date(Date.now() + 10_000) };
    const earlierCallback = { providerCallId: 'CAordering1', from: '+15555556666', to: '+15555550100', callStatus: 'no-answer', timestamp: new Date() };

    await service.recordStatusCallback(laterCallback, channelConnectionId);
    await service.recordStatusCallback(earlierCallback, channelConnectionId);

    const event = await prisma.callEvent.findUnique({ where: { providerCallId: 'CAordering1' } });
    expect(event?.outcome).toBe('ANSWERED'); // completed with duration implies answered; the stale no-answer must not overwrite it
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest call-event.service.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MessageService } from './message.service';
import { VoiceStatusPayload } from '../interfaces/voice-provider.interface';
import { CallOutcome, ChannelType } from '@prisma/client';

const TERMINAL_STATUSES = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled']);
const TEXTBACK_ELIGIBLE: CallOutcome[] = ['NO_ANSWER', 'BUSY', 'CANCELED'];
// Configurable per Antwann's spec ("add a configurable cooldown") -- an env
// var rather than a DB-per-workspace setting for v1 (YAGNI: no UI need yet
// to vary this per Business Unit; revisit if that becomes a real ask).
const COOLDOWN_MINUTES = Number(process.env.MISSED_CALL_TEXTBACK_COOLDOWN_MINUTES ?? 30);

function mapStatusToOutcome(callStatus: string, answeredByMachine?: boolean): CallOutcome {
  if (answeredByMachine) return 'VOICEMAIL';
  switch (callStatus) {
    case 'completed':
      return 'ANSWERED';
    case 'no-answer':
      return 'NO_ANSWER';
    case 'busy':
      return 'BUSY';
    case 'failed':
      return 'FAILED';
    case 'canceled':
      return 'CANCELED';
    default:
      return 'FAILED';
  }
}

@Injectable()
export class CallEventService {
  constructor(
    private prisma: PrismaService,
    private messages: MessageService,
  ) {}

  async recordStatusCallback(
    payload: VoiceStatusPayload,
    channelConnectionId: string,
  ): Promise<void> {
    const connection = await this.prisma.channelConnection.findUnique({
      where: { id: channelConnectionId },
    });
    if (!connection) return;

    const contact = await this.prisma.contact.findFirst({
      where: { workspaceId: connection.workspaceId, phones: { has: payload.from } },
    });

    const existing = await this.prisma.callEvent.findUnique({
      where: { providerCallId: payload.providerCallId },
    });

    if (!existing) {
      await this.prisma.callEvent.create({
        data: {
          workspaceId: connection.workspaceId,
          channelConnectionId,
          contactId: contact?.id,
          providerCallId: payload.providerCallId,
          fromAddress: payload.from,
          startedAt: payload.timestamp,
        },
      });
    }

    if (!TERMINAL_STATUSES.has(payload.callStatus)) return; // ringing/in-progress -- not a final outcome yet

    const current = await this.prisma.callEvent.findUnique({
      where: { providerCallId: payload.providerCallId },
    });
    if (!current) return;

    // Out-of-order guard: a stale terminal callback arriving after a
    // fresher one must never revert the already-resolved outcome.
    if (current.resolvedAt && payload.timestamp < current.resolvedAt) return;

    const outcome = mapStatusToOutcome(payload.callStatus, payload.answeredByMachine);

    await this.prisma.callEvent.update({
      where: { providerCallId: payload.providerCallId },
      data: { outcome, resolvedAt: payload.timestamp },
    });

    if (!TEXTBACK_ELIGIBLE.includes(outcome)) return;

    // Atomic check-and-set cooldown: one transaction finds the most recent
    // text-back for this fromAddress+connection and, only if outside the
    // cooldown window, marks THIS row textBackSent before sending -- closes
    // the same rapid-re-dial double-fire race the Stripe webhook dedup
    // lock closes for concurrent webhook delivery.
    const sent = await this.prisma.$transaction(async (tx) => {
      const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60_000);
      const recentTextback = await tx.callEvent.findFirst({
        where: {
          fromAddress: payload.from,
          channelConnectionId,
          textBackSent: true,
          resolvedAt: { gte: cutoff },
        },
      });
      if (recentTextback) return false;

      await tx.callEvent.update({
        where: { providerCallId: payload.providerCallId },
        data: { textBackSent: true },
      });
      return true;
    });

    if (!sent) return;

    const smsConnection = await this.prisma.channelConnection.findFirst({
      where: { businessUnitId: connection.businessUnitId, type: ChannelType.SMS, status: 'ACTIVE' },
    });
    if (!smsConnection?.externalAddress) return; // SMS not connected yet -- outcome/textBackSent already recorded, nothing more to do

    const template = await this.prisma.messageTemplate.findFirst({
      where: { businessUnitId: connection.businessUnitId, channel: 'SMS', name: 'missed-call-textback', active: true },
    });
    if (!template) return;

    await this.messages.sendSms({
      workspaceId: connection.workspaceId,
      businessUnitId: connection.businessUnitId,
      channelConnectionId: smsConnection.id,
      contactId: contact?.id,
      to: payload.from,
      from: smsConnection.externalAddress,
      body: template.body,
      templateId: template.id,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest call-event.service.spec.ts
```
Expected: PASS, 5/5.

- [ ] **Step 5: Write the voice webhook controller**

```typescript
import { Controller, Post, Body, Headers, Req, UnauthorizedException, HttpCode, Inject } from '@nestjs/common';
import { Request } from 'express';
import { CallEventService } from './call-event.service';
import { PrismaService } from '../../prisma.service';
import { VOICE_PROVIDER, VoiceProvider } from '../interfaces/voice-provider.interface';

@Controller('webhooks/twilio')
export class TwilioVoiceWebhookController {
  constructor(
    private callEvents: CallEventService,
    private prisma: PrismaService,
    @Inject(VOICE_PROVIDER) private voiceProvider: VoiceProvider,
  ) {}

  // NOTE: because of Task 4.5's raw-body middleware, `req.body` here is a
  // Buffer, NOT a parsed object -- same reasoning as TwilioSmsWebhookController
  // in Task 10. Do not use a `@Body()` DTO decorator here.
  @Post('voice-status')
  @HttpCode(200)
  async handleVoiceStatus(
    @Headers('x-twilio-signature') signature: string,
    @Req() req: Request,
  ) {
    const rawFormBody = (req.body as Buffer).toString('utf-8');
    const url = `${process.env.BACKEND_PUBLIC_URL}${req.originalUrl}`;
    if (!this.voiceProvider.verifyInboundWebhookSignature(rawFormBody, signature, url)) {
      throw new UnauthorizedException('Invalid Twilio signature');
    }

    const parsedForm = Object.fromEntries(new URLSearchParams(rawFormBody));
    const payload = this.voiceProvider.parseVoiceStatusCallback(parsedForm);

    const connection = await this.prisma.channelConnection.findFirst({
      where: { externalAddress: payload.to, type: 'VOICE' },
    });
    if (!connection) throw new UnauthorizedException('Unknown destination number');

    await this.callEvents.recordStatusCallback(payload, connection.id);
    return { received: true };
  }
}
```

- [ ] **Step 6: Register in `communications.module.ts`, run `npx tsc --noEmit`, commit**

```bash
git add backend/src/modules/communications/call-event.service.ts backend/src/modules/communications/call-event.service.spec.ts backend/src/modules/communications/voice.controller.ts backend/src/modules/communications/communications.module.ts
git commit -m "feat(communications): missed-call detection, cooldown-guarded text-back, out-of-order-safe outcome resolution"
```

---

### Task 12: ResendAdapter (EmailProvider + InboundEmailProvider + DeliveryStatusProvider)

**Files:**
- Create: `backend/src/modules/communications/providers/resend-adapter.ts`
- Modify: `backend/src/modules/communications/provider-binding.factory.ts` (real Resend branch)
- Modify: `backend/package.json` (add `resend` and `svix` -- Resend signs webhooks using the Svix format, verified via the `svix` npm package per Resend's own documented verification method)
- Test: `backend/src/modules/communications/providers/resend-adapter.spec.ts`

**Interfaces:**
- Consumes: `EmailProvider`, `InboundEmailProvider`, `DeliveryStatusProvider` from Task 2.
- Produces: `ResendAdapter` class, bound by Task 4's factory, used by Tasks 15/16's controllers via the existing `EMAIL_PROVIDER`/`INBOUND_EMAIL_PROVIDER` tokens.

- [ ] **Step 1: Add dependencies**

```bash
cd backend && npm install resend svix
```

- [ ] **Step 2: Write the failing test**

```typescript
import { ResendAdapter } from './resend-adapter';
import { Webhook } from 'svix';

describe('ResendAdapter', () => {
  const webhookSecret = 'whsec_test1234567890abcdef1234567890abcdef1234==';
  let adapter: ResendAdapter;

  beforeAll(() => {
    adapter = new ResendAdapter({
      apiKey: 're_test_key',
      webhookSecret,
      inboundDomain: 'reply.demmmarketing.com',
    });
  });

  it('verifyOutboundWebhookSignature accepts a genuinely svix-signed payload', () => {
    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_123' } });
    const wh = new Webhook(webhookSecret);
    const id = 'msg_test123';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers = { 'svix-id': id, 'svix-timestamp': timestamp } as any;
    const signature = (wh as any).sign(id, new Date(Number(timestamp) * 1000), payload);

    expect(
      adapter.verifyOutboundWebhookSignature(
        payload,
        JSON.stringify({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }),
      ),
    ).toBe(true);
  });

  it('verifyOutboundWebhookSignature rejects a tampered payload', () => {
    expect(
      adapter.verifyOutboundWebhookSignature(
        '{"tampered":true}',
        JSON.stringify({ 'svix-id': 'x', 'svix-timestamp': '0', 'svix-signature': 'v1,bad==' }),
      ),
    ).toBe(false);
  });

  it('parseInboundEmail extracts the reply token from a reply+{token}@ local-part', () => {
    const parsed = adapter.parseInboundEmail({
      from: 'lead@example.com',
      to: 'reply+abc123token@reply.demmmarketing.com',
      subject: 'Re: Hello',
      html: '<p>reply body</p>',
      text: 'reply body',
      email_id: 'em_inbound_1',
    });
    expect(parsed.replyToken).toBe('abc123token');
    expect(parsed.providerMessageId).toBe('em_inbound_1');
  });

  it('parseInboundEmail returns null replyToken for a non-reply-pattern address', () => {
    const parsed = adapter.parseInboundEmail({
      from: 'lead@example.com',
      to: 'hello@reply.demmmarketing.com',
      subject: 'New inquiry',
      html: '<p>hi</p>',
      text: 'hi',
      email_id: 'em_inbound_2',
    });
    expect(parsed.replyToken).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend && npx jest resend-adapter.spec.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { Webhook } from 'svix';
import { EmailProvider } from '../interfaces/email-provider.interface';
import { InboundEmailProvider, InboundEmailPayload } from '../interfaces/inbound-email-provider.interface';
import { DeliveryStatusProvider, ProviderName } from '../interfaces/delivery-status-provider.interface';
import { DeliveryAttemptOutcome } from '@prisma/client';

const RESEND_EVENT_TO_OUTCOME: Record<string, DeliveryAttemptOutcome> = {
  'email.delivered': 'SUCCEEDED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
  'email.delivery_delayed': 'UNDELIVERED',
};

const REPLY_LOCAL_PART_RE = /^reply\+([a-f0-9]+)@/i;

@Injectable()
export class ResendAdapter implements EmailProvider, InboundEmailProvider, DeliveryStatusProvider {
  private client: Resend;

  constructor(
    private config: { apiKey: string; webhookSecret: string; inboundDomain: string },
  ) {
    this.client = new Resend(config.apiKey);
  }

  async sendEmail(params: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
  }): Promise<{ providerMessageId: string }> {
    const result = await this.client.emails.send({
      to: params.to,
      from: params.from,
      replyTo: params.replyTo,
      subject: params.subject,
      html: params.html,
    });
    if (result.error || !result.data) {
      throw new Error(`Resend send failed: ${result.error?.message ?? 'unknown error'}`);
    }
    return { providerMessageId: result.data.id };
  }

  verifyOutboundWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    try {
      const headers = JSON.parse(signatureHeader);
      const wh = new Webhook(this.config.webhookSecret);
      wh.verify(rawBody, headers);
      return true;
    } catch {
      return false;
    }
  }

  verifyInboundWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    return this.verifyOutboundWebhookSignature(rawBody, signatureHeader);
  }

  parseInboundEmail(rawBody: Record<string, unknown>): InboundEmailPayload {
    const to = rawBody.to as string;
    const match = to.match(REPLY_LOCAL_PART_RE);
    return {
      providerMessageId: rawBody.email_id as string,
      from: rawBody.from as string,
      to,
      subject: rawBody.subject as string,
      html: (rawBody.html as string) ?? null,
      text: (rawBody.text as string) ?? null,
      replyToken: match ? match[1] : null,
    };
  }

  normalizeStatus(providerName: ProviderName, rawEvent: Record<string, unknown>): DeliveryAttemptOutcome {
    if (providerName !== 'RESEND') {
      throw new Error(`ResendAdapter cannot normalize ${providerName} events`);
    }
    const type = rawEvent.type as string;
    return RESEND_EVENT_TO_OUTCOME[type] ?? 'FAILED';
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && npx jest resend-adapter.spec.ts
```
Expected: PASS, 4/4.

- [ ] **Step 6: Wire the real branch into the binding factory (same pattern as Task 9 Step 6), confirm build, commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/modules/communications/providers/resend-adapter.ts backend/src/modules/communications/providers/resend-adapter.spec.ts backend/src/modules/communications/provider-binding.factory.ts
git commit -m "feat(communications): ResendAdapter implementing EmailProvider/InboundEmailProvider/DeliveryStatusProvider"
```

---

### Task 13: MessageTemplateService

**Files:**
- Create: `backend/src/modules/communications/message-template.service.ts`
- Create: `backend/src/modules/communications/message-template.controller.ts`
- Test: `backend/src/modules/communications/message-template.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `MessageTemplateService.create/update/list/resolve(templateId, tokens: Record<string,string>)` — `resolve` does the `{{firstName}}`-style substitution Task 11 already needed a raw `template.body` for (Task 11 doesn't need to be modified; the missed-call template happens to have no tokens in its seed content, so plain `template.body` continues to work there — `resolve` is for the outbound email/SMS compose flow in the Inbox UI, Task 17).

- [ ] **Step 1: Write the failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { MessageTemplateService } from './message-template.service';

describe('MessageTemplateService', () => {
  let service: MessageTemplateService;
  let prisma: PrismaService;
  let workspaceId: string;
  let businessUnitId: string;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [MessageTemplateService, PrismaService],
    }).compile();
    service = moduleRef.get(MessageTemplateService);
    prisma = moduleRef.get(PrismaService);

    const org = await prisma.organization.create({ data: { name: 'Tmpl Org' } });
    orgId = org.id;
    const bu = await prisma.businessUnit.create({ data: { name: 'Tmpl BU', key: 'TMPL', organizationId: org.id } });
    businessUnitId = bu.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Tmpl WS', subdomain: `tmpl-${Date.now()}`, organizationId: org.id, businessUnitId: bu.id },
    });
    workspaceId = ws.id;
  });

  afterAll(async () => {
    await prisma.messageTemplate.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.businessUnit.delete({ where: { id: businessUnitId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('create then resolve substitutes {{tokens}} with provided values', async () => {
    const template = await service.create({
      workspaceId,
      businessUnitId,
      channel: 'SMS',
      name: 'welcome',
      body: 'Hi {{firstName}}, thanks for reaching out to {{businessName}}!',
    });

    const resolved = service.resolve(template, { firstName: 'Jordan', businessName: 'DEMM' });
    expect(resolved).toBe('Hi Jordan, thanks for reaching out to DEMM!');
  });

  it('resolve leaves an unmatched token untouched rather than throwing', () => {
    const resolved = service.resolve(
      { body: 'Hi {{firstName}}, {{missingToken}} stays literal.' } as any,
      { firstName: 'Sam' },
    );
    expect(resolved).toBe('Hi Sam, {{missingToken}} stays literal.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest message-template.service.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MessageTemplate, ConversationChannel } from '@prisma/client';

@Injectable()
export class MessageTemplateService {
  constructor(private prisma: PrismaService) {}

  async create(params: {
    workspaceId: string;
    businessUnitId: string;
    channel: ConversationChannel;
    name: string;
    body: string;
  }): Promise<MessageTemplate> {
    return this.prisma.messageTemplate.create({ data: params });
  }

  async list(businessUnitId: string, channel?: ConversationChannel): Promise<MessageTemplate[]> {
    return this.prisma.messageTemplate.findMany({
      where: { businessUnitId, channel, active: true },
    });
  }

  resolve(template: Pick<MessageTemplate, 'body'>, tokens: Record<string, string>): string {
    return template.body.replace(/\{\{(\w+)\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest message-template.service.spec.ts
```
Expected: PASS, 2/2.

- [ ] **Step 5: Write the controller (list + create, role-gated same as Offer management)**

```typescript
import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { MessageTemplateService } from './message-template.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { ConversationChannel } from '@prisma/client';

@Controller('marketing/communications/templates')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class MessageTemplateController {
  constructor(private templates: MessageTemplateService) {}

  @Get()
  list(@Query('businessUnitId') businessUnitId: string, @Query('channel') channel?: ConversationChannel) {
    return this.templates.list(businessUnitId, channel);
  }

  @Post()
  create(@Body() body: { workspaceId: string; businessUnitId: string; channel: ConversationChannel; name: string; body: string }) {
    return this.templates.create(body);
  }
}
```

- [ ] **Step 6: Register, run `npx tsc --noEmit`, commit**

```bash
git add backend/src/modules/communications/message-template.service.ts backend/src/modules/communications/message-template.service.spec.ts backend/src/modules/communications/message-template.controller.ts backend/src/modules/communications/communications.module.ts
git commit -m "feat(communications): MessageTemplateService with token resolution"
```

---

### Task 14: Email outbound + inbound webhook controller (reply-token threading)

**Files:**
- Create: `backend/src/modules/communications/email.controller.ts`
- Test: `backend/test-communications-email-api.ts` (HTTP-level, same pattern as Task 10)

**Interfaces:**
- Consumes: `MessageService.sendEmail/recordInboundEmail` (Task 8), `ConversationService.findByReplyToken` (Task 7), `EMAIL_PROVIDER`/`INBOUND_EMAIL_PROVIDER` tokens, `CommunicationConsentService` (Task 6) for unsubscribe/complaint handling, Task 4.5's raw-body middleware (`req.body` is a `Buffer` on both webhook routes in this controller).
- Produces: `POST /marketing/clients/:id/communications/email` (outbound), `POST /webhooks/resend/inbound` (Resend Receiving), `POST /webhooks/resend/events` (delivery/bounce/complaint/unsubscribe).

- [ ] **Step 1: Write the failing HTTP-level test** (same bootstrap pattern as Task 10 — real app, real HTTP, real Svix-signed fixture payloads built the same way Task 12's adapter spec built them)

`backend/test-communications-email-api.ts`:
```typescript
// Following the exact NestFactory.create(AppModule) + real HTTP call
// pattern established in test-stripe-billing-api.ts and
// test-communications-sms-api.ts. Scenarios required:
// 1. Outbound email with no ChannelConnection ACTIVE -> 503, no fabricated success.
// 2. Inbound webhook to a reply+{token}@... address matching a real
//    Conversation's replyToken -> Message created, direction INBOUND,
//    conversation.lastMessageAt updated.
// 3. Inbound webhook to reply+{unknown-token}@... -> 200 (webhook ack,
//    Resend shouldn't retry) but zero Message rows created, and an
//    anomaly is logged (assert via a CommunicationEvent or log capture --
//    pick whichever this task's implementation actually emits).
// 4. Redelivered identical signed inbound payload -> no duplicate Message
//    (providerMessageId unique constraint).
// 5. A signed "email.complained" event for a Message's providerMessageId
//    -> CommunicationConsent(channel: EMAIL, optedOut: true) written for
//    that message's conversation's contact.
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx ts-node -T test-communications-email-api.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import {
  Controller,
  Post,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  UnauthorizedException,
  ServiceUnavailableException,
  Inject,
  Logger,
} from '@nestjs/common';
import { MessageService } from './message.service';
import { ChannelConnectionService } from './channel-connection.service';
import { ConversationService } from './conversation.service';
import { CommunicationConsentService } from './communication-consent.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';
import { BusinessUnitGuard } from '../../common/guards/business-unit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EMAIL_PROVIDER, EmailProvider } from '../interfaces/email-provider.interface';
import { INBOUND_EMAIL_PROVIDER, InboundEmailProvider } from '../interfaces/inbound-email-provider.interface';
import { DELIVERY_STATUS_PROVIDER, DeliveryStatusProvider } from '../interfaces/delivery-status-provider.interface';
import { PrismaService } from '../../prisma.service';
import { ChannelType, ConsentChannelType } from '@prisma/client';

@Controller('marketing/clients/:id/communications')
@UseGuards(JwtAuthGuard, WorkspaceGuard, BusinessUnitGuard)
export class EmailOutboundController {
  constructor(
    private messages: MessageService,
    private channels: ChannelConnectionService,
    private prisma: PrismaService,
  ) {}

  @Post('email')
  async sendEmail(
    @Param('id') clientAccountId: string,
    @Body() body: { subject: string; html: string },
    @CurrentUser() user: { id: string },
  ) {
    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      include: { primaryContact: true },
    });
    if (!clientAccount) throw new UnauthorizedException('Client not found in scope');

    const connection = await this.channels.findActiveForBusinessUnit(
      clientAccount.businessUnitId,
      ChannelType.EMAIL,
    );
    if (!connection?.externalAddress) {
      throw new ServiceUnavailableException('Email channel is not connected for this Business Unit yet.');
    }

    const conversation = await this.prisma.conversation.upsert({
      where: {
        channelConnectionId_counterpartyAddress: {
          channelConnectionId: connection.id,
          counterpartyAddress: clientAccount.primaryContact.emails[0],
        },
      },
      create: {
        workspaceId: connection.workspaceId,
        businessUnitId: clientAccount.businessUnitId,
        channelConnectionId: connection.id,
        channel: 'EMAIL',
        counterpartyAddress: clientAccount.primaryContact.emails[0],
        contactId: clientAccount.primaryContactId,
        replyToken: require('crypto').randomBytes(16).toString('hex'),
      },
      update: {},
    });

    return this.messages.sendEmail({
      workspaceId: connection.workspaceId,
      businessUnitId: clientAccount.businessUnitId,
      channelConnectionId: connection.id,
      contactId: clientAccount.primaryContactId,
      to: clientAccount.primaryContact.emails[0],
      from: connection.externalAddress,
      replyTo: `reply+${conversation.replyToken}@reply.demmmarketing.com`,
      subject: body.subject,
      html: body.html,
      sentByUserId: user.id,
    });
  }
}

@Controller('webhooks/resend')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    private messages: MessageService,
    private conversations: ConversationService,
    private consent: CommunicationConsentService,
    private prisma: PrismaService,
    @Inject(INBOUND_EMAIL_PROVIDER) private inboundProvider: InboundEmailProvider,
    @Inject(EMAIL_PROVIDER) private emailProvider: EmailProvider,
    @Inject(DELIVERY_STATUS_PROVIDER) private deliveryStatus: DeliveryStatusProvider,
  ) {}

  // NOTE: because of Task 4.5's raw-body middleware, `req.body` here is a
  // Buffer, NOT a parsed object -- do not use a `@Body()` DTO decorator on
  // any method in this controller. Parse the JSON yourself, AFTER signature
  // verification has run against the untouched raw bytes.
  @Post('inbound')
  @HttpCode(200)
  async handleInbound(
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Req() req: Request,
  ) {
    const rawBodyString = (req.body as Buffer).toString('utf-8');
    const headers = JSON.stringify({ 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': svixSignature });
    if (!this.inboundProvider.verifyInboundWebhookSignature(rawBodyString, headers)) {
      throw new UnauthorizedException('Invalid Resend webhook signature');
    }

    const parsedBody = JSON.parse(rawBodyString);
    const payload = this.inboundProvider.parseInboundEmail(parsedBody);
    if (!payload.replyToken) {
      this.logger.warn(`Inbound email to unresolvable address: ${payload.to}`);
      return { received: true };
    }

    const conversation = await this.conversations.findByReplyToken(payload.replyToken);
    if (!conversation) {
      this.logger.warn(`Inbound email replyToken did not resolve to a Conversation: ${payload.replyToken}`);
      return { received: true };
    }

    await this.messages.recordInboundEmail({
      conversationId: conversation.id,
      providerMessageId: payload.providerMessageId,
      html: payload.html,
    });

    return { received: true };
  }

  // IMPORTANT: verify the exact current Resend webhook event type names
  // against https://resend.com/docs/dashboard/webhooks/event-types before
  // implementing this -- do not trust the names below as final, they are
  // this plan's best understanding at write-time and Resend's catalog can
  // add/rename event types. Handle unsubscribe generically (any event type
  // whose name contains "unsubscrib", case-insensitive) as a defensive
  // fallback alongside the exact documented name, so a naming drift doesn't
  // silently stop opt-outs from being honored.
  @Post('events')
  @HttpCode(200)
  async handleEvents(
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Req() req: Request,
  ) {
    const rawBodyString = (req.body as Buffer).toString('utf-8');
    const headers = JSON.stringify({ 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': svixSignature });
    if (!this.emailProvider.verifyOutboundWebhookSignature(rawBodyString, headers)) {
      throw new UnauthorizedException('Invalid Resend webhook signature');
    }

    const rawBody = JSON.parse(rawBodyString);
    const outcome = this.deliveryStatus.normalizeStatus('RESEND', rawBody);
    const emailId = (rawBody.data as any)?.email_id as string;
    const message = await this.prisma.message.findUnique({
      where: { providerMessageId: emailId },
      include: { conversation: true },
    });
    if (!message) return { received: true };

    await this.prisma.deliveryAttempt.create({
      data: { messageId: message.id, outcome, occurredAt: new Date(), providerRaw: rawBody as any },
    });

    const eventType = ((rawBody.type as string) ?? '').toLowerCase();
    const isComplaint = outcome === 'COMPLAINED' || eventType === 'email.complained';
    const isUnsubscribe = eventType.includes('unsubscrib');
    if ((isComplaint || isUnsubscribe) && message.conversation.contactId) {
      await this.consent.recordOptOut(
        message.conversation.contactId,
        ConsentChannelType.EMAIL,
        isComplaint ? 'complaint' : 'unsubscribe-link',
      );
    }

    return { received: true };
  }
}
```

- [ ] **Step 4: Register, fill in test fixtures/assertions, run to verify it passes**

```bash
cd backend && npx ts-node -T test-communications-email-api.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/communications/email.controller.ts backend/src/modules/communications/communications.module.ts backend/test-communications-email-api.ts
git commit -m "feat(communications): email outbound + reply-token-threaded inbound webhook + bounce/complaint consent handling"
```

---

### Task 15: CommunicationRelationshipSignalService (DOM26-R integration)

**Files:**
- Create: `backend/src/modules/communications/communication-relationship-signal.service.ts`
- Modify: `backend/src/modules/communications/communication-consent.service.ts` (call signal creation on opt-out/opt-in — see Step 3)
- Modify: `backend/src/modules/communications/call-event.service.ts` (call signal creation on missed-call detected/text-back sent/suppressed)
- Test: `backend/src/modules/communications/communication-relationship-signal.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`. Mirrors `backend/src/modules/marketing/billing-relationship-signal.service.ts`'s exact shape (`createSignal`, `resolveSignals`, `hasActiveSignal`) — read that file first, do not redesign its pattern.
- Produces: `CommunicationRelationshipSignalService.createSignal(contactId, type, summary)`, `.resolveSignals(contactId, types)`, `.hasActiveSignal(contactId, types)`.

- [ ] **Step 1: Read the existing pattern**

```bash
cd backend && cat src/modules/marketing/billing-relationship-signal.service.ts
```

- [ ] **Step 2: Write the failing test (mirrors the pattern's own test file if one exists, otherwise a minimal direct test)**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { CommunicationRelationshipSignalService } from './communication-relationship-signal.service';

describe('CommunicationRelationshipSignalService', () => {
  let service: CommunicationRelationshipSignalService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CommunicationRelationshipSignalService, PrismaService],
    }).compile();
    service = moduleRef.get(CommunicationRelationshipSignalService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('createSignal then hasActiveSignal returns true for that type', async () => {
    // Fixture setup mirroring the exact RelationshipProfile/RelationshipSubject
    // creation pattern billing-relationship-signal.service.spec.ts (if present)
    // or billing-relationship-signal.service.ts's own callers use -- do not
    // invent a different resolution path for profileId.
  });
});
```

(This task's implementer must open `billing-relationship-signal.service.ts` and its test coverage first — the exact `profileId` resolution mechanism from `contactId` is defined there and must be copied, not redesigned.)

- [ ] **Step 3: Implement, mirroring the existing file's structure exactly**, then wire two call sites:
  - `communication-consent.service.ts`'s `recordOptOut`/`recordOptIn` call `createSignal(contactId, 'CONSENT_STOP' | 'CONSENT_START', ...)` after the Prisma write.
  - `call-event.service.ts`'s missed-call branch calls `createSignal(contactId, 'MISSED_CALL_DETECTED', ...)` and, after a successful text-back send, `createSignal(contactId, 'MISSED_CALL_TEXTBACK_SENT', ...)`.

- [ ] **Step 4: Run the full communications test suite to confirm nothing regressed**

```bash
cd backend && npx jest communications
```
Expected: all prior communications specs still pass plus the new one.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/communications/communication-relationship-signal.service.ts backend/src/modules/communications/communication-relationship-signal.service.spec.ts backend/src/modules/communications/communication-consent.service.ts backend/src/modules/communications/call-event.service.ts backend/src/modules/communications/communications.module.ts
git commit -m "feat(communications): DOM26-R RelationshipSignal wiring for consent and missed-call events"
```

---

### Task 16: Stage 1 comprehensive provider-neutral test suite

**Files:**
- Create: `backend/test-communications-provider-neutral.ts` (HTTP-level, real Nest app, `FakeSmsProvider`/`FakeEmailProvider` bound in place of Null/real adapters via a test-only Nest module override)
- Create: `backend/src/modules/communications/testing/fake-sms-provider.ts`
- Create: `backend/src/modules/communications/testing/fake-email-provider.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-15.
- Produces: `FakeSmsProvider`/`FakeEmailProvider` — deterministic in-memory implementations of `SmsProvider`/`EmailProvider` (record every call, never touch a network), reusable by any future test needing predictable send behavior without mocking each interface method ad hoc.

- [ ] **Step 1: Implement the deterministic fakes**

```typescript
import { SmsProvider, InboundSmsPayload } from '../interfaces/sms-provider.interface';

export class FakeSmsProvider implements SmsProvider {
  sentMessages: Array<{ to: string; from: string; body: string }> = [];
  private counter = 0;

  async sendSms(params: { to: string; from: string; body: string; statusCallbackUrl?: string }) {
    this.sentMessages.push(params);
    this.counter += 1;
    return { providerMessageId: `FAKE_SM_${this.counter}` };
  }

  verifyInboundWebhookSignature(): boolean {
    return true; // fake provider -- Stage 1 tests aren't proving signature verification, Stage 2 does
  }

  parseInboundSms(rawBody: Record<string, unknown>): InboundSmsPayload {
    return {
      providerMessageId: rawBody.providerMessageId as string,
      from: rawBody.from as string,
      to: rawBody.to as string,
      body: rawBody.body as string,
    };
  }
}
```

```typescript
import { EmailProvider } from '../interfaces/email-provider.interface';

export class FakeEmailProvider implements EmailProvider {
  sentEmails: Array<{ to: string; from: string; subject: string; html: string }> = [];
  private counter = 0;

  async sendEmail(params: { to: string; from: string; subject: string; html: string }) {
    this.sentEmails.push(params);
    this.counter += 1;
    return { providerMessageId: `FAKE_EM_${this.counter}` };
  }

  verifyOutboundWebhookSignature(): boolean {
    return true;
  }
}
```

- [ ] **Step 2: Write the comprehensive HTTP-level test file**, overriding `SMS_PROVIDER`/`EMAIL_PROVIDER` providers with the fakes via `moduleRef.overrideProvider`, covering (per Antwann's Stage 1 list): message creation, outbound send state, inbound ingestion, retries, failures, consent, conversation threading, automation stopping (STOP blocks a subsequent send attempt), Business Unit isolation (a second BU's `ChannelConnection` never resolves a first BU's inbound webhook), DOM26-R signal creation.

- [ ] **Step 3: Run and iterate until green**

```bash
cd backend && npx ts-node -T test-communications-provider-neutral.ts
```
Expected: all checks pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/communications/testing/ backend/test-communications-provider-neutral.ts
git commit -m "test(communications): Stage 1 provider-neutral comprehensive suite with deterministic fakes"
```

---

### Task 17: Unified Inbox — backend list/thread endpoints

**Files:**
- Create: `backend/src/modules/communications/inbox.controller.ts`
- Test: `backend/test-communications-inbox-api.ts`

**Interfaces:**
- Consumes: `PrismaService`, existing guard chain.
- Produces: `GET /marketing/communications/inbox` (list conversations for a workspace, with `ChannelConnection.status` included per row so the frontend can render the provider-status banner), `GET /marketing/communications/inbox/:conversationId` (thread — ordered messages + delivery attempts).

- [ ] **Step 1: Write the failing HTTP-level test** covering: list returns conversations ordered by `lastMessageAt desc`; list includes `channelConnection.status`; thread endpoint returns messages ordered oldest-first with their `deliveryAttempts`; a conversation belonging to a different workspace 403s.

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx ts-node -T test-communications-inbox-api.ts
```

- [ ] **Step 3: Implement**

```typescript
import { Controller, Get, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../../common/guards/workspace.guard';

@Controller('marketing/communications/inbox')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class InboxController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Req() req: Request & { workspaceId: string }) {
    return this.prisma.conversation.findMany({
      where: { workspaceId: req.workspaceId },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        channelConnection: { select: { status: true, type: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  @Get(':conversationId')
  async thread(
    @Param('conversationId') conversationId: string,
    @Req() req: Request & { workspaceId: string },
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, include: { deliveryAttempts: true } },
        channelConnection: { select: { status: true, type: true } },
      },
    });
    if (!conversation || conversation.workspaceId !== req.workspaceId) {
      throw new ForbiddenException('Conversation not in scope');
    }
    return conversation;
  }
}
```

- [ ] **Step 4: Run to verify it passes, register, commit**

```bash
git add backend/src/modules/communications/inbox.controller.ts backend/test-communications-inbox-api.ts backend/src/modules/communications/communications.module.ts
git commit -m "feat(communications): unified Inbox list + thread endpoints"
```

---

### Task 18: Unified Inbox — frontend UI

**Files:**
- Create: `frontend/src/app/marketing/communications/page.tsx` (conversation list + provider-status banner)
- Create: `frontend/src/app/marketing/communications/[conversationId]/page.tsx` (thread view + send box)
- Modify: `frontend/src/lib/api.ts` (add `listConversations()`, `getConversationThread(id)`, `sendSms(clientAccountId, body)`, `sendEmail(clientAccountId, subject, html)`)

**Interfaces:**
- Consumes: `GET /marketing/communications/inbox`, `GET /marketing/communications/inbox/:id`, `POST /marketing/clients/:id/communications/sms`, `POST /marketing/clients/:id/communications/email` (Tasks 10, 14, 17).

- [ ] **Step 1: Add the API client functions to `frontend/src/lib/api.ts`**, following the exact `fetch`/auth-header pattern already used by the file's existing functions (`getAuthToken()`, `API_URL` prefix).

- [ ] **Step 2: Build the conversation list page** — table of conversations (counterparty, channel icon, last message preview, `lastMessageAt`), a banner per distinct `channelConnection.status` present (`NOT_CONFIGURED`/`DEGRADED`/`DISCONNECTED` render a visible warning banner; `ACTIVE` renders nothing extra), empty/loading/error states following the existing `Leads`/`Contacts` page patterns for visual consistency.

- [ ] **Step 3: Build the thread view page** — messages in a chat-style layout (direction determines alignment), delivery attempt status shown per outbound message (a `FAILED`/`UNDELIVERED`/`BOUNCED` `DeliveryAttempt` renders visibly, not silently), a send box wired to the SMS/email endpoint matching the conversation's `channel`, disabled with a clear reason when `channelConnection.status !== 'ACTIVE'`.

- [ ] **Step 4: Verify in the browser** (per this session's UI verification workflow) — start the dev server, navigate to `/marketing/communications`, confirm empty state renders correctly with zero `ChannelConnection` rows configured (the expected state until Stage 3), confirm no console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/marketing/communications/ frontend/src/lib/api.ts
git commit -m "feat(communications): unified Inbox frontend -- conversation list, thread view, provider-status banner"
```

---

### Task 19: Stage 2 adapter contract tests (consolidated)

**Files:**
- Create: `backend/test-communications-adapter-contracts.ts`

**Interfaces:**
- Consumes: `TwilioAdapter` (Task 9), `ResendAdapter` (Task 12), Twilio's documented test credentials/magic test numbers, Resend's sandbox sending where available.

Note: Tasks 9 and 12 already wrote unit-level signature-verification tests. This task's job is the **end-to-end contract proof** — booting the real Nest app with real (test-mode) Twilio/Resend adapters bound (requires `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`RESEND_API_KEY` test-mode env vars to be present; if they are not present in this environment, this task's implementer reports `NEEDS_CONTEXT` rather than fabricating results — Stage 2 genuinely cannot run without at least Twilio's free test credentials, which don't require a purchased number or paid plan).

- [ ] **Step 1: Check for Twilio/Resend test-mode credentials in the environment**

```bash
cd backend && node -e "console.log(!!process.env.TWILIO_ACCOUNT_SID, !!process.env.RESEND_API_KEY)"
```

If both are `false false`: this task is `BLOCKED` pending Antwann providing Twilio's free test Account SID/Auth Token pair (no phone number purchase or paid plan needed for these — Twilio issues a test credential pair on every account, including a trial one) and a Resend test-mode API key. Report this clearly rather than skipping or fabricating.

- [ ] **Step 2: If credentials are present, write and run the contract test** exercising: `TwilioAdapter.sendSms` against Twilio's magic test number `+15005550006` (documented to always succeed without a real SMS being sent or billed); a hand-built, correctly-signed inbound SMS webhook fixture is accepted and an incorrectly-signed one is rejected; `ResendAdapter` equivalent using Resend's test-mode sending behavior and a real Svix-signed fixture.

- [ ] **Step 3: Commit whatever state this task actually reaches** (passing suite, or a clear `NEEDS_CONTEXT` report — never a fabricated pass)

```bash
git add backend/test-communications-adapter-contracts.ts
git commit -m "test(communications): Stage 2 adapter contract tests against Twilio/Resend test credentials"
```

---

### Task 20: Full regression suite

**Files:** none created — verification only.

- [ ] **Step 1: Run every existing test suite to confirm zero regressions**

```bash
cd backend && npx jest
cd backend && npx ts-node -T test-stripe-billing-api.ts
cd backend && npx ts-node -T verify-stripe-billing-staging-smoke.ts # local-only invocation, not against staging
cd backend && npx tsc --noEmit -p tsconfig.json
cd backend && npx eslint src
cd frontend && npx tsc --noEmit
```

- [ ] **Step 2: Compare against the Task 20/21 baseline** (80/80 on `test-stripe-billing-api.ts` per the prior sub-project's close) — any newly-failing prior test is a real regression from this plan's changes and must be fixed before proceeding, not waived.

---

### Task 21: Chairman external-setup package (Twilio + Resend)

**Files:**
- Create: `docs/superpowers/specs/2026-07-24-communications-chairman-setup-package.md`

- [ ] **Step 1: Write the Twilio section** — exact account-creation steps, which secrets are required (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — names only, never values), recommended number type (local vs toll-free, and why given SMS+voice both needed), A2P 10DLC requirements and realistic lead time, webhook URLs to register (`/webhooks/twilio/sms`, `/webhooks/twilio/voice-status`), a test procedure using Twilio's free test credentials (no purchase needed to validate the adapter), and production-activation risks (10DLC rejection, carrier filtering, cost surprises at volume).

- [ ] **Step 2: Write the Resend section** — account steps, required secret (`RESEND_API_KEY` — name only), sending-domain DNS records needed on `send.demmmarketing.com`, receiving-domain records needed on `reply.demmmarketing.com` (per the design spec's subdomain recommendation — root domain mailbox behavior untouched), webhook signing secret setup, both webhook URLs (`/webhooks/resend/inbound`, `/webhooks/resend/events`), a test procedure, and production-activation risks (DNS propagation delay, deliverability reputation warm-up, subdomain misconfiguration risk).

- [ ] **Step 3: State explicitly, at the top of the document**: this package is informational only — no account was created, no number was purchased, no DNS was changed, no secret value is recorded anywhere in this document, by this session.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-24-communications-chairman-setup-package.md
git commit -m "docs(communications): Chairman external setup package for Twilio + Resend"
```

---

### Task 22: Final capture and report

**Files:** none — capture and report only.

- [ ] **Step 1: Capture to Dom26v3** — every task's commit SHAs, the 2 real bugs (if any) found during this build, test results across Stage 1/Stage 2, the explicit "FOUNDATION COMPLETE — PROVIDER ACTIVATION PENDING" status, and the Stage 3 gate (Antwann must authorize real account/number/DNS setup before any "OPERATIONAL" claim is made).

- [ ] **Step 2: Update the gbrain page** `demm-crm/communications-core-provider-audit` (from the audit phase) with final build status, or create `demm-crm/unified-communications-core` as the primary page if the audit page's scope no longer fits — implementer's judgment, but do not leave two pages silently duplicating the same status.

- [ ] **Step 3: Score the completed work against the DEMM Autonomous Execution Loop rubric** (product correctness 15, functional completeness 15, security/privacy 20, data integrity/migration safety 10, test quality/regression safety 15, UX/accessibility 10, DOM26-R integration 10, docs/handoff 5) — evidence-based, not confidence language. If below 90 or any unresolved Critical/High issue exists, do not report completion; list findings and remediate first.

- [ ] **Step 4: Final report to Antwann** using exactly the completion language: "COMMUNICATION FOUNDATION COMPLETE — PROVIDER ACTIVATION PENDING." State plainly what Stage 3 needs from him (Twilio test credentials at minimum to unblock Task 19 if it was `BLOCKED`; real account/number/DNS authorization for true end-to-end proof) and that the WTAE/$47-mo pricing project remains queued next, per his stated order.
