import { Injectable } from '@nestjs/common';
import {
  Prisma,
  MemoryForm,
  MemoryTopic,
  TruthClassification,
  SensitivityClassification,
  SourceType,
  SubjectType,
} from '@prisma/client';
import { MemoryCandidateService } from '../dom26r/memory-candidate.service';
import { EngramService } from '../dom26r/engram.service';
import { RelationshipBriefService } from '../dom26r/relationship-brief.service';

/**
 * A fact observed during Lead->Client conversion. Everything here is a
 * CLAIM about the client (what they said, what was promised) except the
 * conversion itself -- claims go in as PENDING MemoryCandidates so a human
 * confirms them before they become durable memory, per the DOM26-R
 * controlled-candidate doctrine.
 */
interface ConversionFact {
  topic: MemoryTopic;
  summary: string;
  content?: Record<string, unknown>;
}

interface RecordConversionFactsParams {
  subjectType: SubjectType;
  subjectRefId: string;
  clientAccountId: string;
  acquisitionSource?: string | null;
  confirmedBusinessContext?: string | null;
  statedGoal?: string | null;
  communicationPreference?: string | null;
  offerId: string;
  offerName: string;
  commitmentsMade?: string[];
  nextPromisedAction?: string | null;
}

@Injectable()
export class MarketingRelationshipService {
  constructor(
    private candidates: MemoryCandidateService,
    private engrams: EngramService,
    private briefs: RelationshipBriefService,
  ) {}

  /**
   * Called from inside Task 7's atomic conversion transaction. Every claim
   * about the client (source, context, goal, preference, offer, promises) is
   * recorded as a PENDING MemoryCandidate awaiting human confirmation -- the
   * one exception is the conversion itself, which is a system-observed fact
   * recorded directly as an ACTIVE Engram, because "this Contact converted
   * to a client" isn't an inferred claim, it's something that just happened.
   */
  async recordConversionFacts(
    tx: Prisma.TransactionClient,
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    params: RecordConversionFactsParams,
  ) {
    const facts: ConversionFact[] = [];

    if (params.acquisitionSource) {
      facts.push({
        topic: MemoryTopic.JOURNEY,
        summary: `Acquisition source: ${params.acquisitionSource}`,
        content: { acquisitionSource: params.acquisitionSource },
      });
    }
    if (params.confirmedBusinessContext) {
      facts.push({
        topic: MemoryTopic.SERVICE_CONTEXT,
        summary: params.confirmedBusinessContext,
        content: { businessContext: params.confirmedBusinessContext },
      });
    }
    if (params.statedGoal) {
      facts.push({
        topic: MemoryTopic.JOURNEY,
        summary: `Stated goal: ${params.statedGoal}`,
        content: { statedGoal: params.statedGoal },
      });
    }
    if (params.communicationPreference) {
      facts.push({
        topic: MemoryTopic.PREFERENCE,
        summary: `Communication preference: ${params.communicationPreference}`,
        content: { communicationPreference: params.communicationPreference },
      });
    }
    facts.push({
      topic: MemoryTopic.SERVICE_CONTEXT,
      summary: `Offer selected: ${params.offerName}`,
      content: { offerId: params.offerId, offerName: params.offerName },
    });
    for (const commitment of params.commitmentsMade ?? []) {
      facts.push({
        topic: MemoryTopic.COMMITMENT,
        summary: commitment,
        content: { commitment },
      });
    }
    if (params.nextPromisedAction) {
      facts.push({
        topic: MemoryTopic.COMMITMENT,
        summary: `Next promised action: ${params.nextPromisedAction}`,
        content: { nextPromisedAction: params.nextPromisedAction },
      });
    }

    const createdCandidates = [];
    for (const fact of facts) {
      const candidate = await this.candidates.create(
        organizationId,
        businessUnitId,
        workspaceId,
        actorId,
        correlationId,
        {
          subjectType: params.subjectType,
          subjectRefId: params.subjectRefId,
          form: MemoryForm.SEMANTIC,
          topic: fact.topic,
          proposedTruth: TruthClassification.INFERRED,
          confidence: 0.6,
          sensitivity: SensitivityClassification.INTERNAL,
          consentBasis: 'CONTRACT',
          summary: fact.summary,
          content: fact.content,
          sources: [
            { type: SourceType.EVENT, referenceId: params.clientAccountId },
          ],
        },
        tx,
      );
      createdCandidates.push(candidate);
    }

    const milestoneEngram = await this.engrams.create(
      organizationId,
      businessUnitId,
      workspaceId,
      actorId,
      correlationId,
      {
        subjectType: params.subjectType,
        subjectRefId: params.subjectRefId,
        form: MemoryForm.EPISODIC,
        topic: MemoryTopic.MILESTONE,
        truthClassification: TruthClassification.OBSERVED,
        sensitivity: SensitivityClassification.INTERNAL,
        summary: `Converted to client on offer "${params.offerName}"`,
        structuredContent: {
          clientAccountId: params.clientAccountId,
          offerId: params.offerId,
          offerName: params.offerName,
        },
        sources: [
          { type: SourceType.EVENT, referenceId: params.clientAccountId },
        ],
      },
      tx,
    );

    return { candidates: createdCandidates, milestoneEngram };
  }

  /**
   * Builds a Marketing-facing relationship brief: identity/business,
   * relationship stage, selected Offer, stated goal, confirmed preferences,
   * previous interaction, open commitment, next action, and anything
   * pending reconfirmation. The evidence engrams passed in must already
   * belong to this profile -- RelationshipBriefService.generate enforces
   * that boundary.
   */
  async generateMarketingBrief(
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    correlationId: string,
    profileId: string,
    briefText: string,
    engramIds: string[],
    sensitivity: SensitivityClassification = SensitivityClassification.INTERNAL,
  ) {
    return this.briefs.generate(
      organizationId,
      businessUnitId,
      actorId,
      correlationId,
      {
        profileId,
        briefText,
        generator: 'marketing-relationship-service',
        version: '1.0',
        sensitivity,
        engramIds,
      },
    );
  }

  /**
   * System-observed onboarding milestones go directly to an ACTIVE Engram
   * (not a pending MemoryCandidate) -- "this item was completed" or "the
   * client was activated" are facts, not inferred claims. Routine
   * IN_PROGRESS/WAITING_ON_CLIENT toggles do NOT call this -- only real
   * milestones: plan generated, a required item completed, an override
   * applied, activation, a blocker raised or resolved.
   */
  async recordOnboardingMilestone(
    tx: Prisma.TransactionClient,
    organizationId: string,
    businessUnitId: string,
    workspaceId: string | null,
    actorId: string,
    correlationId: string,
    params: {
      subjectType: SubjectType;
      subjectRefId: string;
      clientAccountId: string;
      summary: string;
      structuredContent: Record<string, unknown>;
    },
  ) {
    return this.engrams.create(
      organizationId,
      businessUnitId,
      workspaceId,
      actorId,
      correlationId,
      {
        subjectType: params.subjectType,
        subjectRefId: params.subjectRefId,
        form: MemoryForm.EPISODIC,
        topic: MemoryTopic.MILESTONE,
        truthClassification: TruthClassification.OBSERVED,
        sensitivity: SensitivityClassification.INTERNAL,
        summary: params.summary,
        structuredContent: params.structuredContent,
        sources: [
          { type: SourceType.EVENT, referenceId: params.clientAccountId },
        ],
      },
      tx,
    );
  }
}
