/**
 * Dashboard state classification.
 *
 * This exists because of a specific defect: the dashboard read every number as
 * `data?.stats?.x ?? 0`, so when the request FAILED, `data` stayed null and all
 * four cards rendered `0`. A backend outage was indistinguishable from a quiet
 * business day, and the only trace was a `console.error` nobody sees.
 *
 * The fix is to make "we have no data" un-renderable as "the data is zero".
 * Every caller must go through this classifier, and only a real response can
 * produce READY or EMPTY.
 */

export interface DashboardStats {
  leadsToday: number;
  projectedRevenue: number;
  likelyToBookCount: number;
  needsFollowup: number;
  openDealsCount: number;
}

export type DashboardState =
  /** The request is still in flight. */
  | { kind: 'LOADING' }
  /** A real response with at least one non-zero figure. */
  | { kind: 'READY'; stats: DashboardStats }
  /** A real response in which everything is genuinely zero. */
  | { kind: 'EMPTY'; stats: DashboardStats }
  /** The backend refused: this account cannot see this workspace's numbers. */
  | { kind: 'FORBIDDEN' }
  /** Anything else -- offline, timeout, 5xx, or a response we cannot trust. */
  | { kind: 'UNAVAILABLE'; detail?: string };

export interface DashboardInput {
  loading: boolean;
  error: { status?: number; message?: string } | null;
  data: { stats?: Partial<DashboardStats> | null } | null;
}

/** Reads one numeric field, refusing anything that is not a real number. */
function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function classifyDashboard(input: DashboardInput): DashboardState {
  if (input.loading) return { kind: 'LOADING' };

  if (input.error) {
    if (input.error.status === 403) return { kind: 'FORBIDDEN' };
    return { kind: 'UNAVAILABLE', detail: input.error.message };
  }

  const raw = input.data?.stats;
  if (!raw) {
    // No error was recorded, but no usable payload arrived either. Reporting
    // this as UNAVAILABLE rather than as zeros is the whole point of the file.
    return { kind: 'UNAVAILABLE' };
  }

  const stats: DashboardStats = {
    leadsToday: numeric(raw.leadsToday) ?? 0,
    projectedRevenue: numeric(raw.projectedRevenue) ?? 0,
    likelyToBookCount: numeric(raw.likelyToBookCount) ?? 0,
    needsFollowup: numeric(raw.needsFollowup) ?? 0,
    openDealsCount: numeric(raw.openDealsCount) ?? 0,
  };

  const everythingZero = Object.values(stats).every((n) => n === 0);
  return everythingZero ? { kind: 'EMPTY', stats } : { kind: 'READY', stats };
}

/**
 * The only thing the dashboard says about workflows.
 *
 * Future tense on purpose. The workflow engine does not exist in this version,
 * so the dashboard states that plainly instead of showing invented playbooks,
 * invented failures, and an invented repair button. No control is offered,
 * because there is nothing behind it.
 */
export const WORKFLOW_COPY = {
  heading: 'No workflows are active yet.',
  detail:
    'The guided workflow builder is not available in this version. When it ships, workflows you create will show up here.',
} as const;
