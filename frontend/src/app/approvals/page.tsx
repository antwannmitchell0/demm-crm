'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import { api, getAuthToken, getActiveUser, ApiError } from '../../lib/api';
import { ShieldCheck, Loader2, Check, X, Undo2 } from 'lucide-react';

/**
 * The approval inbox.
 *
 * Every high-risk action staged by the agent used to become invisible the
 * moment it was created: nothing listed approvals, so the resolve endpoint was
 * reachable only by someone who already had an id they had no way to obtain. In
 * practice a staged action sat until it expired.
 *
 * Nothing on this page is inferred. Each row shows the tool that was staged,
 * the arguments as submitted, who asked, the role they held when they asked,
 * and when the window closes -- all of it read from the server. There is no
 * summary, no risk score, and no recommendation, because the backend computes
 * none of those and inventing them here would be the same fabrication this work
 * removed elsewhere.
 */

interface Approval {
  id: string;
  toolName: string;
  arguments: Record<string, unknown> | null;
  status: string;
  requesterRole: string | null;
  requestedById: string;
  requestedByEmail: string | null;
  requestedByName: string | null;
  createdAt: string;
  expiresAt: string | null;
}

type LoadState =
  | { kind: 'LOADING' }
  | { kind: 'READY'; approvals: Approval[] }
  | { kind: 'ERROR'; message: string };

const ADMIN_ROLES = new Set([
  'WORKSPACE_ADMIN',
  'ORG_ADMIN',
  'ORG_OWNER',
  'SUPERADMIN',
]);

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-950/30 border-amber-500/30 text-amber-300',
  APPROVED: 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300',
  REJECTED: 'bg-rose-950/30 border-rose-500/30 text-rose-300',
  EXPIRED: 'bg-slate-900 border-slate-700 text-slate-400',
  CANCELLED: 'bg-slate-900 border-slate-700 text-slate-400',
};

/** Written out so a reader never has to know what the enum means. */
const STATUS_WORDS: Record<string, string> = {
  PENDING: 'Waiting for a decision',
  APPROVED: 'Approved and run',
  REJECTED: 'Rejected by an approver',
  EXPIRED: 'Window closed before anyone decided',
  CANCELLED: 'Withdrawn by the person who asked',
};

function formatWhen(iso: string | null): string {
  if (!iso) return 'no expiry recorded';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export default function ApprovalsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'LOADING' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const me = getActiveUser();
  const canResolve = !!me && ADMIN_ROLES.has(me.role);

  const load = useCallback(async () => {
    try {
      const data = await api.getApprovals();
      setState({
        kind: 'READY',
        approvals: Array.isArray(data?.approvals) ? data.approvals : [],
      });
    } catch (err: unknown) {
      setState({
        kind: 'ERROR',
        message:
          err instanceof ApiError
            ? err.message
            : 'Could not load approvals right now.',
      });
    }
  }, []);

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    void load();
  }, [router, load]);

  const act = async (id: string, run: () => Promise<unknown>) => {
    setActionError(null);
    setBusyId(id);
    try {
      await run();
      await load();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiError ? err.message : 'That did not go through.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount =
    state.kind === 'READY'
      ? state.approvals.filter((a) => a.status === 'PENDING').length
      : 0;

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-6 sm:p-8 overflow-y-auto max-w-5xl mx-auto w-full space-y-6">
        <header>
          <h2 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-cyan-400 shrink-0" />
            <span>Approvals</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            {state.kind === 'READY' && pendingCount === 0
              ? 'Nothing is waiting for a decision.'
              : 'Actions the agent staged instead of running, because they were judged high-risk. Nothing here has happened yet.'}
          </p>
        </header>

        {actionError ? (
          <div
            role="alert"
            className="p-4 rounded-2xl border bg-rose-950/20 border-rose-500/30 text-rose-300 text-sm"
          >
            {actionError}
          </div>
        ) : null}

        {state.kind === 'LOADING' ? (
          <div className="flex items-center gap-3 text-slate-400 text-sm p-6">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>Loading approvals...</span>
          </div>
        ) : null}

        {state.kind === 'ERROR' ? (
          <div
            role="alert"
            className="p-6 rounded-2xl border border-rose-500/30 bg-rose-950/20"
          >
            <p className="text-sm text-rose-300">{state.message}</p>
            <button
              onClick={() => void load()}
              className="mt-3 px-4 py-2 rounded-xl border border-slate-700 text-sm text-slate-200 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 transition"
            >
              Try again
            </button>
          </div>
        ) : null}

        {state.kind === 'READY' && state.approvals.length === 0 ? (
          <div className="p-8 rounded-2xl border border-slate-800 bg-slate-950/40 text-center">
            <p className="text-sm text-slate-300 font-semibold">
              No actions have been staged for approval.
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              When someone runs an action the workspace treats as high-risk, it
              waits here instead of running.
            </p>
          </div>
        ) : null}

        {state.kind === 'READY'
          ? state.approvals.map((a) => {
              const isMine = !!me && a.requestedById === me.id;
              const isPending = a.status === 'PENDING';
              const busy = busyId === a.id;

              return (
                <article
                  key={a.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold text-slate-100 break-words">
                        {a.toolName}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Asked by {a.requestedByName ?? a.requestedByEmail ?? 'a member'}
                        {a.requesterRole ? ` (${a.requesterRole})` : ''} on{' '}
                        {formatWhen(a.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full border text-[11px] font-semibold whitespace-nowrap ${
                        STATUS_STYLES[a.status] ??
                        'bg-slate-900 border-slate-700 text-slate-400'
                      }`}
                    >
                      {STATUS_WORDS[a.status] ?? a.status}
                    </span>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-600 font-medium mb-1">
                      Exactly what was submitted
                    </p>
                    {/* Rendered verbatim. Summarising it would mean deciding
                        what an approver does not need to see. */}
                    <pre className="text-xs text-slate-300 bg-black/40 border border-slate-800 rounded-xl p-3 overflow-x-auto">
                      {JSON.stringify(a.arguments ?? {}, null, 2)}
                    </pre>
                  </div>

                  {isPending ? (
                    <p className="text-xs text-slate-500">
                      Decision window closes {formatWhen(a.expiresAt)}.
                    </p>
                  ) : null}

                  {isPending ? (
                    <div className="flex flex-wrap gap-2">
                      {canResolve && !isMine ? (
                        <>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act(a.id, () =>
                                api.resolveApproval(a.id, 'APPROVE'),
                              )
                            }
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold whitespace-nowrap hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed transition"
                          >
                            {busy ? (
                              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                            ) : (
                              <Check className="w-4 h-4 shrink-0" />
                            )}
                            <span>Approve and run</span>
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act(a.id, () =>
                                api.resolveApproval(a.id, 'REJECT'),
                              )
                            }
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-700 text-slate-200 text-sm font-semibold whitespace-nowrap hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed transition"
                          >
                            <X className="w-4 h-4 shrink-0" />
                            <span>Reject</span>
                          </button>
                        </>
                      ) : null}

                      {isMine ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(a.id, () => api.cancelApproval(a.id))
                          }
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-700 text-slate-200 text-sm font-semibold whitespace-nowrap hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed transition"
                        >
                          {busy ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          ) : (
                            <Undo2 className="w-4 h-4 shrink-0" />
                          )}
                          <span>Withdraw</span>
                        </button>
                      ) : null}

                      {/* Stated, not hidden. A pending row with no buttons and
                          no explanation reads as a broken page. */}
                      {isMine && canResolve ? (
                        <p className="text-xs text-slate-500 self-center">
                          You asked for this one, so you cannot approve it
                          yourself.
                        </p>
                      ) : null}
                      {!isMine && !canResolve ? (
                        <p className="text-xs text-slate-500 self-center">
                          An administrator has to decide this one.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })
          : null}
      </main>
    </div>
  );
}
