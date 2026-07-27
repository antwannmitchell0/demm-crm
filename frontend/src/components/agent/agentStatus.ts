/**
 * Agent Console outcome vocabulary.
 *
 * This exists because of a specific defect: the console set
 * `agentText = "Executed tool '...' successfully."` BEFORE it looked at the
 * response status, so any status the code did not recognise -- including a
 * missing one -- was announced to the user as a successful execution.
 *
 * The rule enforced here is simple and absolute: **only a real SUCCESS response
 * sets `hasExecuted`.** Everything else, including anything unrecognised, is
 * reported as not-executed.
 *
 * Vocabulary is deliberately plain. No "autonomous", no "cognitive", no
 * "agentic", no "orchestration" -- the person reading it wants to know whether
 * their action ran.
 */

export type AgentOutcome =
  | { kind: 'SUCCESS'; hasExecuted: true; headline: string; result: unknown }
  | {
      kind: 'APPROVAL_REQUIRED';
      hasExecuted: false;
      headline: string;
      detail: string;
      approvalId: string | null;
      expiresAt: string | null;
    }
  | { kind: 'FAILED'; hasExecuted: false; headline: string; detail: string }
  | { kind: 'CANCELLED'; hasExecuted: false; headline: string; detail: string }
  | { kind: 'REJECTED'; hasExecuted: false; headline: string; detail: string }
  | { kind: 'EXPIRED'; hasExecuted: false; headline: string; detail: string }
  | { kind: 'UNKNOWN'; hasExecuted: false; headline: string; detail: string };

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Turns a raw `/agent/execute` response into something a person can read.
 * Never invents a status and never upgrades an unclear response to success.
 */
export function describeAgentResponse(response: unknown): AgentOutcome {
  const body = (response ?? {}) as Record<string, unknown>;
  const status = textOrNull(body.status);

  switch (status) {
    case 'SUCCESS':
      return {
        kind: 'SUCCESS',
        hasExecuted: true,
        headline: 'The action ran.',
        result: body.result ?? null,
      };

    case 'PENDING_APPROVAL':
      return {
        kind: 'APPROVAL_REQUIRED',
        hasExecuted: false,
        headline: 'Waiting for approval. An administrator has to approve this.',
        detail:
          'Nothing has been changed yet. The action will only run after someone with admin access approves it.',
        approvalId: textOrNull(body.approvalId),
        expiresAt: textOrNull(body.expiresAt),
      };

    case 'ERROR':
      return {
        kind: 'FAILED',
        hasExecuted: false,
        headline: 'The action failed.',
        // The real backend message, not a friendly substitute. Hiding it is how
        // people end up debugging the wrong thing.
        detail: textOrNull(body.error) ?? 'The server did not say why.',
      };

    case 'CANCELLED':
      return {
        kind: 'CANCELLED',
        hasExecuted: false,
        headline: 'The action was cancelled.',
        detail: textOrNull(body.message) ?? 'It was stopped before it ran.',
      };

    case 'REJECTED':
      return {
        kind: 'REJECTED',
        hasExecuted: false,
        headline: 'An administrator turned this down.',
        detail: textOrNull(body.message) ?? 'The action was not run.',
      };

    case 'EXPIRED':
      return {
        kind: 'EXPIRED',
        hasExecuted: false,
        headline: 'This request sat too long and expired.',
        detail: textOrNull(body.message) ?? 'Send it again if you still need it.',
      };

    default:
      return {
        kind: 'UNKNOWN',
        hasExecuted: false,
        headline: 'We could not tell what happened.',
        detail:
          'The server sent back something this version does not understand, so we cannot say whether the action ran. Check with an administrator before trying again.',
      };
  }
}

// ---------------------------------------------------------------------------
// Tool list
// ---------------------------------------------------------------------------

export interface AgentTool {
  name: string;
  description?: string;
  permissions?: string[];
}

export type ToolListState =
  | { kind: 'LOADING' }
  /** The backend returned tools. Exactly these, in this order. */
  | { kind: 'READY'; tools: AgentTool[] }
  /** The backend returned nothing. That stays nothing -- no defaults. */
  | { kind: 'EMPTY' }
  | { kind: 'FORBIDDEN' }
  | { kind: 'UNAVAILABLE'; detail?: string };

export interface ToolListInput {
  loading: boolean;
  error: { status?: number; message?: string } | null;
  tools: AgentTool[] | null;
}

/**
 * There is no fallback list anywhere in this file. If the backend registers no
 * tools, the console shows none; if the call fails, the console says so. A
 * sample tool shown here would be a promise the product cannot keep.
 */
export function classifyToolList(input: ToolListInput): ToolListState {
  if (input.loading) return { kind: 'LOADING' };
  if (input.error) {
    if (input.error.status === 403) return { kind: 'FORBIDDEN' };
    return { kind: 'UNAVAILABLE', detail: input.error.message };
  }
  if (!Array.isArray(input.tools) || input.tools.length === 0) {
    return { kind: 'EMPTY' };
  }
  return { kind: 'READY', tools: input.tools };
}

/**
 * Lists the FIELD NAMES a request carried -- never the values.
 *
 * The old console rendered `JSON.stringify(args)` straight into the transcript,
 * so anything typed into a field was echoed on screen and stayed in the log
 * above. Names alone are enough for someone to see what they sent, and no
 * amount of sensitive input can leak through a list of keys.
 */
export function summarizeArgumentFields(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  return Object.keys(args as Record<string, unknown>);
}

/**
 * Why the console offers no "preview the steps" button.
 *
 * There is no planner. The backend used to expose `POST /agent/plan/preview`,
 * but it keyword-matched the description and returned hard-coded steps that
 * invented a contact unrelated to the workspace; that endpoint has since been
 * deleted rather than merely hidden. Multi-step planning belongs to the AI
 * workflow phase, so until it exists the console says so plainly instead of
 * offering a button that would show a guess.
 */
export const STEP_PREVIEW_COPY = {
  heading: 'Step preview is not available yet.',
  detail:
    'This version cannot show you the steps before they run. Pick an action below and run it directly.',
} as const;
