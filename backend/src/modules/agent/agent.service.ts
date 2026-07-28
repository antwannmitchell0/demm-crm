import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ContactService } from '../contact/contact.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { OpportunityService } from '../opportunity/opportunity.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { redactAuditPayload } from '../../common/utils/audit-redactor';
import { ApprovalStatus, Prisma, Role } from '@prisma/client';
import { ApprovalResolutionAction } from './dto/resolve-approval.dto';

/**
 * Audit `action` values for the approval lifecycle. Exported so the
 * regression suite asserts against the same vocabulary the service writes
 * rather than duplicating string literals that can silently drift apart.
 *
 * These are distinct from a tool-execution audit row, whose `action` is the
 * tool name itself (unchanged, pre-existing behaviour).
 */
export const APPROVAL_AUDIT_ACTIONS = {
  STAGED: 'APPROVAL_STAGED',
  APPROVED: 'APPROVAL_APPROVED',
  REJECTED: 'APPROVAL_REJECTED',
  EXPIRED: 'APPROVAL_EXPIRED',
  LEGACY_REFUSED: 'APPROVAL_LEGACY_REFUSED',
  STAGING_REFUSED: 'APPROVAL_STAGING_REFUSED',
  // An AUTHORIZATION refusal, deliberately distinct from APPROVAL_REJECTED.
  // A rejection is a human decision that terminates the approval; this is a
  // blocked attempt that changes nothing.
  SELF_APPROVAL_REFUSED: 'APPROVAL_SELF_APPROVAL_REFUSED',
  // The REQUESTER withdrew their own request before anyone decided. Distinct
  // from APPROVAL_REJECTED, which records an approver's decision: these rows
  // carry no approver at all.
  CANCELLED: 'APPROVAL_CANCELLED',
} as const;

/**
 * Machine-readable refusal codes returned in the 409 body. The HTTP status is
 * the same for every refusal (all are "this approval is not in a resolvable
 * state"), so the code is what lets a caller -- or a test -- tell the cases
 * apart without string-matching prose.
 */
export const APPROVAL_REFUSAL_REASONS = {
  NOT_PENDING: 'APPROVAL_NOT_PENDING',
  EXPIRED: 'APPROVAL_EXPIRED',
  MISSING_REQUESTER_ROLE: 'APPROVAL_MISSING_REQUESTER_ROLE',
  ARGUMENTS_NOT_STORABLE: 'APPROVAL_ARGUMENTS_NOT_STORABLE',
  SELF_APPROVAL_FORBIDDEN: 'APPROVAL_SELF_APPROVAL_FORBIDDEN',
  INVALID_ACTION: 'APPROVAL_INVALID_ACTION',
} as const;

/**
 * The exact marker `redactAuditPayload` substitutes for a sensitive value.
 * Kept in one place because the staging guard below compares against it.
 */
const REDACTED_MARKER = '[REDACTED]';

/**
 * How long a staged high-risk approval stays resolvable. Mirrors the 7-day
 * window already used for refresh tokens in auth.service.ts -- reusing the
 * established convention rather than inventing a second expiry policy.
 */
const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ApprovalExecutionContext {
  approvalId: string;
  approvedById: string;
}

interface RunToolParams {
  workspaceId: string;
  /**
   * Whose action this is. For a direct call this is the caller; for an
   * approved high-risk action this is the ORIGINAL REQUESTER, never the
   * approver. It lands in AuditLog.actorId.
   */
  actorUserId: string;
  /**
   * The role the action executes under. For an approved high-risk action this
   * is the role captured on the approval record at staging time -- never the
   * approver's current role, which would silently re-authorize the action at
   * the approver's privilege level.
   */
  actorRole: string;
  toolName: string;
  args: any;
  sessionId?: string;
  approvalContext?: ApprovalExecutionContext;
}

/**
 * One argument a tool accepts, as published to callers.
 *
 * `required` mirrors the underlying service signature, so it is a statement
 * about what the handler will actually dereference -- not a UI hint. Keep the
 * two in step: a parameter documented as optional but dereferenced
 * unconditionally is a lie that produces a 500 instead of a 400.
 */
export interface AgentToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'object';
  required: boolean;
  description: string;
}

@Injectable()
export class AgentService {
  private toolRegistry = new Map<
    string,
    {
      description: string;
      permissions: string[];
      /**
       * Published so a console can warn that submitting this action may stage
       * an approval rather than run. `isHighRisk` is a predicate over the
       * arguments and cannot be evaluated before the user has supplied them;
       * this flag says only whether the predicate can ever return true.
       */
      canRequireApproval: boolean;
      parameters: AgentToolParameter[];
      isHighRisk: (args: any) => boolean;
      handler: (workspaceId: string, userId: string, args: any) => Promise<any>;
    }
  >();

  private activeExecutions = new Map<
    string,
    {
      abortController: AbortController;
      toolName: string;
      startedAt: Date;
    }
  >();

  private completedExecutions = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private contactService: ContactService,
    private pipelineService: PipelineService,
    private opportunityService: OpportunityService,
    private dashboardService: DashboardService,
  ) {
    this.registerTools();
  }

  private registerTools() {
    this.toolRegistry.set('getDashboard', {
      description:
        'Retrieve the daily executive brief and key performance indicators.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN', 'USER'],
      canRequireApproval: false,
      // Takes nothing. An empty array is the honest answer; omitting the key
      // would be indistinguishable from "not documented yet".
      parameters: [],
      isHighRisk: () => false,
      handler: async (workspaceId, userId) => {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        return this.dashboardService.getDashboardData(workspaceId, user);
      },
    });

    this.toolRegistry.set('createContact', {
      description: 'Create a new contact record.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      canRequireApproval: false,
      parameters: [
        {
          name: 'firstName',
          type: 'string',
          required: true,
          description: "The contact's given name.",
        },
        {
          name: 'lastName',
          type: 'string',
          required: true,
          description: "The contact's family name.",
        },
        {
          name: 'emails',
          type: 'string[]',
          required: false,
          description: 'One or more email addresses.',
        },
        {
          name: 'phones',
          type: 'string[]',
          required: false,
          description: 'One or more phone numbers.',
        },
        {
          name: 'tags',
          type: 'string[]',
          required: false,
          description: 'Free-form labels used for filtering and search.',
        },
        {
          name: 'source',
          type: 'string',
          required: false,
          description: 'Where this contact came from, e.g. "referral".',
        },
        {
          name: 'companyId',
          type: 'string',
          required: false,
          description:
            'Id of a company in this workspace to link the contact to.',
        },
      ],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.contactService.create(workspaceId, args);
      },
    });

    this.toolRegistry.set('searchContacts', {
      description: 'Search contacts by name, email, phone, or tags.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN', 'USER'],
      canRequireApproval: false,
      parameters: [
        {
          name: 'query',
          type: 'string',
          required: false,
          description:
            'Text to match against name, email, phone or tags. Omitted or empty returns every contact in the workspace.',
        },
      ],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.contactService.search(workspaceId, args.query || '');
      },
    });

    this.toolRegistry.set('createPipeline', {
      description: 'Create a new deal pipeline.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      canRequireApproval: false,
      parameters: [
        {
          name: 'name',
          type: 'string',
          required: true,
          description: 'Display name for the pipeline.',
        },
      ],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.pipelineService.create(workspaceId, args.name);
      },
    });

    this.toolRegistry.set('createOpportunity', {
      description: 'Create a new deal opportunity.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      // The only tool whose isHighRisk predicate can return true.
      canRequireApproval: true,
      parameters: [
        {
          name: 'name',
          type: 'string',
          required: true,
          description: 'Display name for the deal.',
        },
        {
          name: 'pipelineId',
          type: 'string',
          required: true,
          description: 'Id of the pipeline this deal belongs to.',
        },
        {
          name: 'stageId',
          type: 'string',
          required: true,
          description:
            'Id of the stage to open the deal in. Must belong to the pipeline above.',
        },
        {
          name: 'value',
          type: 'number',
          required: false,
          description:
            'Deal value. Above 5000 this action is staged for approval instead of running immediately.',
        },
        {
          name: 'probability',
          type: 'number',
          required: false,
          description: 'Percentage likelihood of closing, 0-100.',
        },
        {
          name: 'contactId',
          type: 'string',
          required: false,
          description: 'Id of the contact this deal is with.',
        },
      ],
      isHighRisk: (args) => (args.value || 0) > 5000,
      handler: async (workspaceId, userId, args) => {
        return this.opportunityService.create(workspaceId, args);
      },
    });

    this.toolRegistry.set('moveOpportunity', {
      description: 'Move an opportunity to another stage.',
      permissions: ['ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'],
      canRequireApproval: false,
      parameters: [
        {
          name: 'id',
          type: 'string',
          required: true,
          description: 'Id of the opportunity to move.',
        },
        {
          name: 'stageId',
          type: 'string',
          required: true,
          description: 'Id of the destination stage.',
        },
      ],
      isHighRisk: () => false,
      handler: async (workspaceId, userId, args) => {
        return this.opportunityService.moveStage(
          workspaceId,
          args.id,
          args.stageId,
        );
      },
    });
  }

  getRegisteredTools() {
    const list = [];
    for (const [name, value] of this.toolRegistry.entries()) {
      list.push({
        name,
        description: value.description,
        permissions: value.permissions,
        canRequireApproval: value.canRequireApproval,
        // Copied, not referenced: the registry is a long-lived singleton and a
        // caller mutating the published array would silently reshape what every
        // later caller is told this tool accepts.
        parameters: value.parameters.map((p) => ({ ...p })),
      });
    }
    return list;
  }

  // REMOVED: previewPlan(). It advertised itself as a planner but matched the
  // word "wedding" in the description and returned hard-coded steps, one of
  // which created a contact -- name, surname and email address -- that the user
  // had never mentioned. Anything else returned a single "Standard Pipeline"
  // step. It was reachable by any token holder and had no route to becoming
  // correct, so it was deleted rather than hidden. A real planner belongs to
  // the AI workflow phase and must be built against the tool registry below.

  cancelExecution(sessionId: string) {
    const active = this.activeExecutions.get(sessionId);
    if (!active) {
      if (this.completedExecutions.has(sessionId)) {
        return {
          status: 'NOT_FOUND',
          message:
            'Best-effort pre-commit cancellation: pre-commit already resolved.',
        };
      }
      const abortController = new AbortController();
      abortController.abort();
      this.activeExecutions.set(sessionId, {
        abortController,
        toolName: 'pre-emptive-abort',
        startedAt: new Date(),
      });
      return {
        status: 'CANCELLED',
        message:
          'Best-effort pre-commit cancellation: pre-emptive abort applied.',
      };
    }

    active.abortController.abort();
    this.activeExecutions.delete(sessionId);
    this.completedExecutions.add(sessionId);

    return {
      status: 'CANCELLED',
      message: `Best-effort pre-commit cancellation: Active run for '${active.toolName}' cancelled.`,
    };
  }

  private getToolOrThrow(toolName: string) {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new NotFoundException(`Tool '${toolName}' not found`);
    }
    return tool;
  }

  private assertToolPermission(
    tool: { permissions: string[] },
    userRole: string,
    toolName: string,
  ) {
    if (!tool.permissions.includes(userRole)) {
      throw new ForbiddenException(
        `Access Denied: Role '${userRole}' lacks permission for '${toolName}'`,
      );
    }
  }

  /**
   * Normalizes a value into plain JSON before it is redacted, compared, or
   * stored in AuditLog.
   * in AuditLog.response.
   *
   * Found by the Phase 0 approval regression suite: `redactAuditPayload` walks
   * an object with Object.entries, which turns a Prisma `Decimal` (and any
   * other class instance) into a plain object carrying a `constructor`
   * function. Prisma then refuses the write with "We could not serialize
   * [object Function]", the surrounding catch converts it into
   * `{ status: 'ERROR' }`, and a tool that actually SUCCEEDED gets reported as
   * failed. This is a pre-existing defect in the execution audit path -- it was
   * simply unreachable until this repair let a high-risk `createOpportunity`
   * (the first tool whose result contains a Decimal) execute for real.
   *
   * JSON-normalizing first lets Decimal.toJSON()/Date.toJSON() produce faithful
   * scalar values, and drops function members. Redaction still runs afterwards,
   * so nothing sensitive reaches the database unredacted.
   */
  private toJsonSafe(value: any): any {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      // Circular or otherwise unrepresentable: record that truthfully rather
      // than failing the audit write (and therefore the execution report).
      return { unserializable: true, valueType: typeof value };
    }
  }

  /**
   * Collects the dot-paths at which redaction replaced a value, so a refusal
   * can name the offending FIELDS without ever echoing their VALUES.
   */
  private collectRedactedPaths(
    original: any,
    redacted: any,
    path = '',
  ): string[] {
    if (redacted === REDACTED_MARKER && original !== REDACTED_MARKER) {
      return [path || '(root)'];
    }
    if (
      original === null ||
      redacted === null ||
      typeof original !== 'object' ||
      typeof redacted !== 'object'
    ) {
      return [];
    }
    const paths: string[] = [];
    if (Array.isArray(original) && Array.isArray(redacted)) {
      for (let i = 0; i < original.length; i++) {
        paths.push(
          ...this.collectRedactedPaths(
            original[i],
            redacted[i],
            `${path}[${i}]`,
          ),
        );
      }
      return paths;
    }
    for (const key of Object.keys(original)) {
      paths.push(
        ...this.collectRedactedPaths(
          original[key],
          (redacted as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        ),
      );
    }
    return paths;
  }

  /**
   * Validates a role string against the shared `Role` enum and returns it.
   *
   * Throws rather than defaulting. An approval whose requester role cannot be
   * recorded would be unresolvable forever (resolveApproval fails closed on a
   * null requesterRole), so refusing at staging time avoids creating the dead
   * row. Contrast the pre-repair code, which fell back to 'USER' and could
   * therefore silently misrecord the authority an action ran under.
   */
  private toRoleOrThrow(role: string): Role {
    if ((Object.values(Role) as string[]).includes(role)) {
      return role as Role;
    }
    throw new ForbiddenException(
      `Access Denied: '${role}' is not a recognized role and cannot be recorded as approval authority`,
    );
  }

  /**
   * PUBLIC ENTRY POINT. Unchanged signature and unchanged external contract.
   *
   * Verifies permission, classifies risk, then either stages an approval or
   * delegates to the private execution core. It is the ONLY path that can
   * stage an approval, and the approved-execution path deliberately does not
   * come back through here -- that re-entry was the Phase 0 approval loop.
   */
  async executeTool(
    workspaceId: string,
    userId: string,
    toolName: string,
    args: any,
    userRole: string,
    sessionId?: string,
  ) {
    const tool = this.getToolOrThrow(toolName);
    this.assertToolPermission(tool, userRole, toolName);

    if (tool.isHighRisk(args)) {
      return this.stageApproval(workspaceId, userId, toolName, args, userRole);
    }

    return this.runTool({
      workspaceId,
      actorUserId: userId,
      actorRole: userRole,
      toolName,
      args,
      sessionId,
    });
  }

  /**
   * Stages a high-risk action for human approval.
   *
   * TEMPORARY ARCHITECTURAL INVARIANT (Phase 0 -> Phase 6):
   * `AgentApproval.arguments` is a single column serving two incompatible
   * purposes -- it is BOTH the audit record of what was requested AND the
   * execution input replayed later by executeApprovedTool. Because it stores
   * the REDACTED form, any argument whose value redaction rewrites would be
   * executed as the literal string '[REDACTED]', silently corrupting the
   * action. `redactAuditPayload` matches key SUBSTRINGS including 'key', and
   * 'key' is a legitimate business column on BusinessUnit, Offer,
   * OfferSnapshot and ConversionIdempotencyKey -- so this is a realistic
   * corruption vector, not a theoretical one.
   *
   * Therefore: APPROVAL-GATED TOOLS MUST NOT ACCEPT SECRET-BEARING OR
   * REDACTION-TRIGGERING EXECUTION ARGUMENTS until Phase 6 (Integration Action
   * Layer) separates encrypted execution arguments from redacted audit
   * arguments. The guard below enforces that invariant mechanically by failing
   * closed rather than trusting future authors to remember it.
   */
  private async stageApproval(
    workspaceId: string,
    requesterId: string,
    toolName: string,
    args: any,
    requesterRole: string,
  ) {
    // Normalize both sides through the same JSON projection so the comparison
    // reflects only redaction, never representational differences.
    const normalizedArgs = this.toJsonSafe(args);
    const sanitizedArgs = redactAuditPayload(normalizedArgs);

    if (JSON.stringify(sanitizedArgs) !== JSON.stringify(normalizedArgs)) {
      const unstorableFields = this.collectRedactedPaths(
        normalizedArgs,
        sanitizedArgs,
      );

      // Field NAMES only -- never the values, which is the whole point of the
      // refusal. Recorded with a null approvalId because no approval exists.
      await this.writeApprovalAudit({
        action: APPROVAL_AUDIT_ACTIONS.STAGING_REFUSED,
        workspaceId,
        actorType: 'USER',
        actorId: requesterId,
        approvalId: null,
        toolName,
        requestedById: requesterId,
        requesterRole: null,
        approvedById: null,
        outcome: 'REFUSED_ARGUMENTS_NOT_STORABLE',
        extra: { unstorableFields },
      });

      throw new BadRequestException({
        statusCode: 400,
        reason: APPROVAL_REFUSAL_REASONS.ARGUMENTS_NOT_STORABLE,
        message:
          `'${toolName}' cannot be staged for approval: one or more arguments must be redacted for storage, ` +
          'and this architecture would then execute the redacted placeholder instead of the real value. ' +
          'Approval-gated actions must not carry secret-bearing arguments until encrypted execution arguments exist. ' +
          'Nothing was stored and nothing was executed.',
        unstorableFields,
      });
    }

    const stagedRole = this.toRoleOrThrow(requesterRole);
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);

    const approval = await this.prisma.agentApproval.create({
      data: {
        toolName,
        arguments: sanitizedArgs,
        status: ApprovalStatus.PENDING,
        workspaceId,
        requestedById: requesterId,
        requesterRole: stagedRole,
        expiresAt,
      },
    });

    await this.writeApprovalAudit({
      action: APPROVAL_AUDIT_ACTIONS.STAGED,
      workspaceId,
      actorType: 'USER',
      actorId: requesterId,
      approvalId: approval.id,
      toolName,
      requestedById: requesterId,
      requesterRole: stagedRole,
      approvedById: null,
      outcome: 'PENDING',
      extra: { arguments: sanitizedArgs, expiresAt: expiresAt.toISOString() },
    });

    return {
      status: 'PENDING_APPROVAL',
      approvalId: approval.id,
      expiresAt: expiresAt.toISOString(),
      message: `Human approval required: '${toolName}' is classified as high-risk. Approval record staged.`,
    };
  }

  /**
   * PRIVATE EXECUTION CORE. Executes an ALREADY-AUTHORIZED tool.
   *
   * Deliberately has no risk classification and no approval staging: that is
   * what makes it safe to reach from the approved-execution path without
   * re-entering the staging branch. There is no public `skipRiskCheck`-style
   * flag that would let an arbitrary caller opt out of approval.
   *
   * ON THE `private` BOUNDARY: TypeScript `private` is a COMPILE-TIME and
   * CODE-REVIEW boundary, not a runtime one. It is not cryptographic and not
   * runtime-inaccessible -- `(service as any).runTool(...)` would still reach
   * this method at runtime. The boundary is therefore a maintained invariant,
   * not an enforced sandbox:
   *   - controllers and ordinary modules MUST NOT invoke this method;
   *   - all approved execution MUST flow through resolveApproval(), which is
   *     what performs the atomic claim that authorizes exactly one execution.
   * Any future caller that bypasses resolveApproval bypasses human approval.
   *
   * Validation (tool lookup + role permission), redaction, audit writing and
   * error semantics are preserved exactly as before -- including returning a
   * captured `{ status: 'ERROR' }` for handler failures rather than throwing.
   */
  private async runTool(params: RunToolParams) {
    const tool = this.getToolOrThrow(params.toolName);
    // Re-checked here, not merely at the entry point, because this method is
    // independently reachable from the approved path -- where the role that
    // must govern is the requester's staged role.
    this.assertToolPermission(tool, params.actorRole, params.toolName);

    const sanitizedArgs = redactAuditPayload(params.args);
    const finalSessionId = params.sessionId || `session_${Date.now()}`;
    let abortController = new AbortController();

    const preExisting = this.activeExecutions.get(finalSessionId);
    if (preExisting) {
      abortController = preExisting.abortController;
    } else {
      this.activeExecutions.set(finalSessionId, {
        abortController,
        toolName: params.toolName,
        startedAt: new Date(),
      });
    }

    // For an approved run the payload additionally carries the approval id and
    // the approver id, so the execution row is linkable to the governance rows
    // without the approver ever displacing the requester in `actorId`.
    const auditPayload: Prisma.InputJsonObject = params.approvalContext
      ? {
          arguments: sanitizedArgs,
          approvalId: params.approvalContext.approvalId,
          approvedById: params.approvalContext.approvedById,
          requestedById: params.actorUserId,
          executedAsRole: params.actorRole,
        }
      : sanitizedArgs;

    // PHASE 0 AUDIT LIMITATION (accepted, not hidden). The intent-row write
    // below, the tool handler, and the result-row update are three separate
    // transactions. Therefore:
    //   - a tool can succeed BEFORE its result audit is persisted, so an
    //     execution may be real while its audit row still shows no response;
    //   - if the result update fails, the catch path records `{ error }` and
    //     this method returns ERROR even though the business action OCCURRED --
    //     i.e. an audit-persistence failure can currently make a successful
    //     action report as failed.
    // Phase 5 must move these writes onto the durable execution substrate and
    // transactional outbox so the state change and its audit commit together.
    const auditLog = await this.prisma.auditLog.create({
      data: {
        actorType: 'AGENT',
        actorId: params.actorUserId,
        action: params.toolName,
        payload: auditPayload,
        workspaceId: params.workspaceId,
        userId: params.actorUserId,
      },
    });

    try {
      if (abortController.signal.aborted) {
        throw new Error(
          'Transaction aborted early via best-effort pre-commit cancellation.',
        );
      }

      const result = await tool.handler(
        params.workspaceId,
        params.actorUserId,
        params.args,
      );

      this.activeExecutions.delete(finalSessionId);
      this.completedExecutions.add(finalSessionId);

      const sanitizedResult = redactAuditPayload(this.toJsonSafe(result));

      await this.prisma.auditLog.update({
        where: { id: auditLog.id },
        data: { response: sanitizedResult },
      });

      return {
        status: 'SUCCESS',
        result,
      };
    } catch (error: any) {
      this.activeExecutions.delete(finalSessionId);
      this.completedExecutions.add(finalSessionId);

      const errorMsg = error.message || 'Workflow execution error';
      await this.prisma.auditLog.update({
        where: { id: auditLog.id },
        data: { response: { error: errorMsg } },
      });

      return {
        status: 'ERROR',
        error: errorMsg,
      };
    }
  }

  /**
   * APPROVED EXECUTION PATH. Reachable only from resolveApproval().
   *
   * Every execution parameter is derived from the approval record, which is
   * the sole authority for what was approved: workspace, requester identity,
   * requester role, tool and arguments. The approver contributes resolver
   * metadata only.
   */
  private async executeApprovedTool(
    approval: {
      id: string;
      workspaceId: string;
      requestedById: string;
      requesterRole: Role | null;
      toolName: string;
      arguments: Prisma.JsonValue;
    },
    approvedById: string,
  ) {
    if (approval.requesterRole === null) {
      // Defensive: the atomic claim already required a non-null requesterRole.
      throw new ConflictException({
        statusCode: 409,
        reason: APPROVAL_REFUSAL_REASONS.MISSING_REQUESTER_ROLE,
        message:
          'Approval cannot be executed: no requester role was captured when it was staged. Please submit the action again.',
      });
    }

    try {
      return await this.runTool({
        workspaceId: approval.workspaceId,
        actorUserId: approval.requestedById,
        actorRole: approval.requesterRole,
        toolName: approval.toolName,
        args: approval.arguments,
        approvalContext: { approvalId: approval.id, approvedById },
      });
    } catch (error: any) {
      // The approval decision is already committed and must NOT be reverted to
      // PENDING because execution failed (that would re-open an already-made
      // human decision).
      //
      // WHAT CAN REACH THIS CATCH -- deliberately NOT only pre-execution
      // refusals:
      //   - pre-execution permission/validation failures: an unknown tool, or a
      //     staged requesterRole that no longer satisfies the tool's
      //     permissions;
      //   - tool-handler failures that runTool did not capture itself;
      //   - audit-persistence failures, including failure of runTool's own
      //     catch-path audit update;
      //   - serialization or other post-handler failures.
      //
      // CONSEQUENCE, EXPLICITLY ACCEPTED FOR PHASE 0: in the post-handler cases
      // the business action MAY ALREADY HAVE SUCCEEDED while this returns an
      // error. The error is honest about the REQUEST outcome but is NOT proof
      // that nothing changed. Phase 5's durable execution substrate and
      // transactional outbox are what remove this ambiguity.
      const errorMsg = error?.message || 'Approved execution failed';
      await this.prisma.auditLog.create({
        data: {
          actorType: 'AGENT',
          actorId: approval.requestedById,
          action: approval.toolName,
          payload: {
            approvalId: approval.id,
            approvedById,
            requestedById: approval.requestedById,
            executedAsRole: approval.requesterRole,
            outcome: 'EXECUTION_REFUSED',
          },
          response: { error: errorMsg },
          workspaceId: approval.workspaceId,
          userId: approval.requestedById,
        },
      });

      return {
        status: 'ERROR',
        error: errorMsg,
      };
    }
  }

  /**
   * Resolves a staged high-risk approval.
   *
   * EXECUTION GUARANTEES -- stated precisely, because the distinction matters:
   *
   *   - EXACTLY-ONCE APPROVAL DECISION: guaranteed. The state transition is an
   *     atomic conditional UPDATE (`updateMany` with a status precondition)
   *     rather than a read-then-write, so exactly one caller can move the row
   *     out of PENDING. Concurrent and replayed resolutions match zero rows and
   *     are refused with a conflict.
   *   - AT-MOST-ONCE TOOL EXECUTION: guaranteed. Execution is gated behind a
   *     won claim, so a losing or replayed caller never executes.
   *   - NOT EXACTLY-ONCE TOOL EXECUTION. The claim commits BEFORE the tool
   *     runs, and there is no resumption. A process crash after the claim but
   *     before (or during) execution leaves an APPROVED approval whose action
   *     never ran. Such a record is detectable -- an APPROVED approval with no
   *     corresponding AGENT execution audit row for its approvalId -- but it is
   *     not recovered automatically; the action must be re-submitted.
   *   - NOT IDEMPOTENT EXECUTION. Tool handlers carry no idempotency key, so a
   *     re-run would duplicate effects. Re-running cannot currently happen only
   *     because the claim is already consumed, not because handlers are safe.
   *
   * At-most-once is the deliberate fail-safe direction for high-risk actions:
   * skipping is safer than double-executing a commitment. Durable, resumable,
   * exactly-once execution is DEFERRED TO PHASE 5 (durable execution substrate
   * with claimable, resumable jobs and a transactional outbox).
   */
  /**
   * The approval inbox.
   *
   * Before this existed, a staged high-risk action was invisible: nothing
   * listed approvals, so `POST /agent/approvals/:id/resolve` could only be
   * called by someone who already had an id they had no way to obtain. Staged
   * actions sat until they expired.
   *
   * PENDING first, then everything else newest-first. Not filtered to PENDING
   * by default: a queue that silently hides resolved items reads as "nothing
   * happened" when in fact something was rejected or expired, which is the
   * opposite of what an approval record is for.
   */
  async listApprovals(workspaceId: string, status?: ApprovalStatus) {
    const approvals = await this.prisma.agentApproval.findMany({
      where: { workspaceId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });

    // Requester emails are resolved in one query rather than per row.
    const requesterIds = [...new Set(approvals.map((a) => a.requestedById))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: requesterIds } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rank = (s: ApprovalStatus) => (s === ApprovalStatus.PENDING ? 0 : 1);

    return {
      approvals: approvals
        .sort(
          (a, b) =>
            rank(a.status) - rank(b.status) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .map((a) => ({
          id: a.id,
          toolName: a.toolName,
          // Already sanitized at staging time -- staging refuses outright if
          // any argument would have to be redacted to be stored, so what is
          // here is what was submitted.
          arguments: a.arguments,
          status: a.status,
          // The role the REQUESTER held when they staged it. Showing the
          // approver's own role here would misrepresent the authority the
          // action will actually execute under.
          requesterRole: a.requesterRole,
          requestedById: a.requestedById,
          requestedByEmail: byId.get(a.requestedById)?.email ?? null,
          requestedByName: byId.get(a.requestedById)
            ? `${byId.get(a.requestedById)!.firstName} ${byId.get(a.requestedById)!.lastName}`
            : null,
          createdAt: a.createdAt.toISOString(),
          expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
          resolvedById: a.resolvedById,
        })),
    };
  }

  /**
   * Withdraws a still-pending request, by the person who made it.
   *
   * A requester who staged something by mistake previously had no way out:
   * only an administrator could reject it, and only if they somehow learned it
   * existed. Cancellation is restricted to the requester on purpose -- an
   * administrator already has REJECT, and letting them cancel instead would let
   * a decision be recorded as if no decision had been made.
   *
   * CANCELLED is a distinct terminal state rather than a reuse of REJECTED. On
   * a REJECTED row `resolvedById` names the approver who decided; on a
   * CANCELLED row it is null because nobody approved anything. Collapsing the
   * two would produce a row claiming a human declined the action with no human
   * attached to it.
   */
  async cancelApproval(
    workspaceId: string,
    requesterId: string,
    approvalId: string,
  ) {
    const existing = await this.prisma.agentApproval.findUnique({
      where: { id: approvalId },
    });

    // Tenant isolation, matching resolveApproval: an approval belonging to
    // another workspace is indistinguishable from one that does not exist.
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new NotFoundException('Staged approval record not found');
    }

    if (existing.requestedById !== requesterId) {
      throw new ForbiddenException(
        'Only the person who requested this action can withdraw it. An administrator can reject it instead.',
      );
    }

    // Conditional claim, like every other state transition here: two
    // simultaneous cancels cannot both write an audit row, and a cancel racing
    // a resolve cannot overwrite the approver's decision.
    const claim = await this.prisma.agentApproval.updateMany({
      where: {
        id: approvalId,
        workspaceId,
        status: ApprovalStatus.PENDING,
      },
      data: { status: ApprovalStatus.CANCELLED },
    });

    if (claim.count !== 1) {
      throw new ConflictException({
        statusCode: 409,
        reason: APPROVAL_REFUSAL_REASONS.NOT_PENDING,
        message:
          'This request is no longer pending, so it cannot be withdrawn. Nothing was changed.',
      });
    }

    await this.writeApprovalAudit({
      action: APPROVAL_AUDIT_ACTIONS.CANCELLED,
      workspaceId,
      actorType: 'USER',
      actorId: requesterId,
      approvalId,
      toolName: existing.toolName,
      requestedById: existing.requestedById,
      requesterRole: existing.requesterRole,
      // Explicitly null: no approver acted. This is the field that makes
      // CANCELLED distinguishable from REJECTED in the audit record.
      approvedById: null,
      outcome: 'CANCELLED',
    });

    return {
      id: approvalId,
      status: ApprovalStatus.CANCELLED,
      message: 'Request withdrawn. Nothing was executed.',
    };
  }

  async resolveApproval(
    workspaceId: string,
    approverId: string,
    approvalId: string,
    action: ApprovalResolutionAction,
  ) {
    // DEFENCE IN DEPTH at the service boundary. The controller now binds a
    // validated DTO, but this method is a public service API: any future
    // caller (a queue consumer, another module, a script) would otherwise
    // inherit the original defect, because the branch below treats REJECT as
    // one case and routes EVERYTHING ELSE through APPROVE. Fail closed here
    // rather than letting an unrecognised value mean "approve".
    //
    // Deliberately the FIRST statement: it throws before any row is read,
    // before any state transition, and before any audit event is written.
    if (
      action !== ApprovalResolutionAction.APPROVE &&
      action !== ApprovalResolutionAction.REJECT
    ) {
      throw new BadRequestException({
        statusCode: 400,
        reason: APPROVAL_REFUSAL_REASONS.INVALID_ACTION,
        message:
          "Resolution action must be exactly 'APPROVE' or 'REJECT'. Nothing was read, changed or executed.",
      });
    }

    const now = new Date();

    const existing = await this.prisma.agentApproval.findUnique({
      where: { id: approvalId },
    });

    // Tenant isolation: an approval belonging to another workspace is
    // indistinguishable from one that does not exist.
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new NotFoundException('Staged approval record not found');
    }

    // Lapsed window. One atomic path moves PENDING -> EXPIRED; whoever wins
    // that update writes the audit row, and every caller is then refused.
    if (
      existing.status === ApprovalStatus.PENDING &&
      existing.expiresAt !== null &&
      existing.expiresAt <= now
    ) {
      const expiredClaim = await this.prisma.agentApproval.updateMany({
        where: {
          id: approvalId,
          workspaceId,
          status: ApprovalStatus.PENDING,
        },
        data: { status: ApprovalStatus.EXPIRED },
      });

      if (expiredClaim.count === 1) {
        await this.writeApprovalAudit({
          action: APPROVAL_AUDIT_ACTIONS.EXPIRED,
          workspaceId,
          // The clock closed this window, not a person.
          actorType: 'SYSTEM',
          actorId: null,
          approvalId,
          toolName: existing.toolName,
          requestedById: existing.requestedById,
          requesterRole: existing.requesterRole,
          approvedById: null,
          outcome: 'EXPIRED',
          extra: { expiresAt: existing.expiresAt.toISOString() },
        });
      }

      throw new ConflictException({
        statusCode: 409,
        reason: APPROVAL_REFUSAL_REASONS.EXPIRED,
        message:
          'Approval window has closed; nothing was executed. Please submit the action again.',
      });
    }

    // Fail closed on approvals staged before requesterRole existed. Their
    // staging-time authority is unknowable after the fact, and guessing it
    // (for instance from the approver) is exactly the privilege confusion this
    // repair removes.
    if (
      existing.status === ApprovalStatus.PENDING &&
      existing.requesterRole === null
    ) {
      await this.writeApprovalAudit({
        action: APPROVAL_AUDIT_ACTIONS.LEGACY_REFUSED,
        workspaceId,
        actorType: 'USER',
        actorId: approverId,
        approvalId,
        toolName: existing.toolName,
        requestedById: existing.requestedById,
        requesterRole: null,
        approvedById: approverId,
        outcome: 'REFUSED_MISSING_REQUESTER_ROLE',
      });

      throw new ConflictException({
        statusCode: 409,
        reason: APPROVAL_REFUSAL_REASONS.MISSING_REQUESTER_ROLE,
        message:
          'This approval predates requester-role capture and cannot be executed safely. Please submit the action again.',
      });
    }

    // REJECT is deliberately NOT subject to the separation-of-duties rule that
    // governs APPROVE. Rejecting is a decision to NOT act: it executes nothing
    // and closes the request, so a requester rejecting their own pending
    // request is a legitimate cancellation, not a privilege escalation. There
    // is no security reason to force a second person to decline an action that
    // will not happen either way.
    //
    // KNOWN LIMITATION introduced by the T4 role gate: because the endpoint now
    // requires an administrative role, a requester holding only the USER role
    // cannot reach it to cancel their own request. A dedicated cancellation
    // route for requesters was explicitly out of scope for T4.
    if (action === ApprovalResolutionAction.REJECT) {
      const rejectClaim = await this.prisma.agentApproval.updateMany({
        where: {
          id: approvalId,
          workspaceId,
          status: ApprovalStatus.PENDING,
        },
        data: {
          status: ApprovalStatus.REJECTED,
          resolvedById: approverId,
        },
      });

      if (rejectClaim.count !== 1) {
        throw new ConflictException({
          statusCode: 409,
          reason: APPROVAL_REFUSAL_REASONS.NOT_PENDING,
          message:
            'Approval is no longer pending and cannot be resolved again; nothing was executed.',
        });
      }

      await this.writeApprovalAudit({
        action: APPROVAL_AUDIT_ACTIONS.REJECTED,
        workspaceId,
        actorType: 'USER',
        actorId: approverId,
        approvalId,
        toolName: existing.toolName,
        requestedById: existing.requestedById,
        requesterRole: existing.requesterRole,
        approvedById: approverId,
        outcome: 'REJECTED',
      });

      return {
        status: 'REJECTED',
        approvalId,
        message: 'High-risk action rejected. Nothing was executed.',
      };
    }

    // SEPARATION OF DUTIES. The person who requested a high-risk action may not
    // be the person who authorizes it -- otherwise the approval gate is
    // decorative, since any requester could self-clear their own request.
    //
    // This preliminary check exists to produce an understandable 403 (a bare
    // failed claim would surface as a misleading "no longer pending" conflict).
    // It is NOT the enforcement point: the claim predicate below repeats the
    // rule atomically, so the prohibition holds even under a concurrent race
    // or a future caller that skips this branch.
    //
    // Note this is an AUTHORIZATION refusal, not a rejection: the approval is
    // left PENDING and untouched, so a properly authorized administrator can
    // still resolve it afterwards.
    if (existing.requestedById === approverId) {
      await this.writeApprovalAudit({
        action: APPROVAL_AUDIT_ACTIONS.SELF_APPROVAL_REFUSED,
        workspaceId,
        actorType: 'USER',
        actorId: approverId,
        approvalId,
        toolName: existing.toolName,
        requestedById: existing.requestedById,
        requesterRole: existing.requesterRole,
        // The blocked attempt's actor, recorded separately from the requester
        // even though they are the same person -- that identity collision is
        // precisely the fact being audited.
        approvedById: approverId,
        outcome: 'REFUSED_SELF_APPROVAL',
      });

      throw new ForbiddenException({
        statusCode: 403,
        reason: APPROVAL_REFUSAL_REASONS.SELF_APPROVAL_FORBIDDEN,
        message:
          'You cannot approve your own high-risk request. Another authorized administrator must resolve it. Nothing was executed and the request is still pending.',
      });
    }

    // APPROVE. The precondition set is the whole safety contract: right
    // approval, right workspace, still pending, requester role recorded, not
    // past its window, and NOT self-approved.
    const approveClaim = await this.prisma.agentApproval.updateMany({
      where: {
        id: approvalId,
        workspaceId,
        status: ApprovalStatus.PENDING,
        requesterRole: { not: null },
        // Atomic enforcement of separation of duties -- the database, not the
        // application, is the final authority on this rule.
        requestedById: { not: approverId },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        status: ApprovalStatus.APPROVED,
        resolvedById: approverId,
      },
    });

    if (approveClaim.count !== 1) {
      throw new ConflictException({
        statusCode: 409,
        reason: APPROVAL_REFUSAL_REASONS.NOT_PENDING,
        message:
          'Approval is no longer pending and cannot be resolved again; nothing was executed.',
      });
    }

    // PHASE 0 AUDIT LIMITATION (accepted, not hidden). The claim above and the
    // governance audit row below are SEPARATE transactions, and the same is
    // true of the REJECT and EXPIRED transitions earlier in this method. A
    // crash or an audit failure between them leaves a committed state
    // transition with NO corresponding audit event. Lifecycle auditing is
    // therefore best-effort in Phase 0, not transactionally guaranteed.
    // Phase 5 must couple them via the transactional outbox.
    await this.writeApprovalAudit({
      action: APPROVAL_AUDIT_ACTIONS.APPROVED,
      workspaceId,
      // The approver is the actor of the DECISION. The actor of the resulting
      // EXECUTION is the original requester -- see runTool.
      actorType: 'USER',
      actorId: approverId,
      approvalId,
      toolName: existing.toolName,
      requestedById: existing.requestedById,
      requesterRole: existing.requesterRole,
      approvedById: approverId,
      outcome: 'APPROVED',
    });

    // Only the winner of the claim reaches execution.
    const execResult = await this.executeApprovedTool(existing, approverId);

    return {
      status: 'APPROVED',
      approvalId,
      result: execResult,
    };
  }

  /**
   * Writes one approval-lifecycle governance row.
   *
   * AuditLog has no correlationId column (unlike MemoryAuditEvent) and the
   * controller does not pass the request correlation id into this service, so
   * `approvalId` is the correlation key that stitches STAGED -> APPROVED /
   * REJECTED / EXPIRED -> execution together. Threading the real correlation
   * id requires a controller change, which is out of scope for this slice.
   */
  private async writeApprovalAudit(params: {
    action: string;
    workspaceId: string;
    actorType: 'USER' | 'SYSTEM';
    actorId: string | null;
    // Null only for APPROVAL_STAGING_REFUSED, where the refusal happens before
    // any approval row is created.
    approvalId: string | null;
    toolName: string;
    requestedById: string;
    requesterRole: Role | null;
    approvedById: string | null;
    outcome: string;
    extra?: Record<string, unknown>;
  }) {
    const payload: Record<string, unknown> = {
      approvalId: params.approvalId,
      toolName: params.toolName,
      requestedById: params.requestedById,
      requesterRole: params.requesterRole,
      approvedById: params.approvedById,
      outcome: params.outcome,
      ...(params.extra ?? {}),
    };

    await this.prisma.auditLog.create({
      data: {
        actorType: params.actorType,
        actorId: params.actorId,
        action: params.action,
        // Defence in depth: `extra` is the only caller-supplied branch and it
        // already carries redacted arguments, but re-running the redactor
        // guarantees no lifecycle row can ever carry a secret.
        payload: redactAuditPayload(payload) as Prisma.InputJsonObject,
        workspaceId: params.workspaceId,
        // AuditLog.userId is a real FK; SYSTEM rows have no user.
        userId: params.actorId,
      },
    });
  }
}
