'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getAuthToken, getActiveUser, ApiError } from '../../lib/api';
import { MailCheck, Loader2 } from 'lucide-react';

/**
 * Accepting an invitation link.
 *
 * The link carries the raw token. Acceptance requires a signed-in account whose
 * email matches the address the invitation was issued to -- possession of the
 * link is necessary but NOT sufficient, so a forwarded link cannot be used by
 * whoever receives it. That check happens on the server; this page only reports
 * what it said.
 *
 * The token is read from the query string and never written anywhere: not to
 * storage, not to a log, not into the URL after acceptance. The address bar is
 * left as the user opened it and the redirect replaces the entry entirely.
 */

type Phase =
  | { kind: 'CHECKING' }
  | { kind: 'NEEDS_SIGN_IN' }
  | { kind: 'NO_TOKEN' }
  | { kind: 'READY' }
  | { kind: 'WORKING' }
  | { kind: 'DONE' }
  // Accepted, but the account no longer has access -- an administrator removed
  // them after they used the link. A distinct state, because it is neither a
  // success to celebrate nor a failure to retry.
  | { kind: 'NO_ACCESS' }
  | { kind: 'FAILED'; message: string };

function InviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [phase, setPhase] = useState<Phase>({ kind: 'CHECKING' });

  const me = getActiveUser();

  useEffect(() => {
    if (!token) {
      setPhase({ kind: 'NO_TOKEN' });
      return;
    }
    if (!getAuthToken()) {
      setPhase({ kind: 'NEEDS_SIGN_IN' });
      return;
    }
    setPhase({ kind: 'READY' });
  }, [token]);

  const accept = async () => {
    if (!token) return;
    setPhase({ kind: 'WORKING' });
    try {
      const result = await api.acceptInvitation(token);

      // HTTP 200 does NOT mean "you're in". Acceptance is idempotent, so the
      // server also answers 200 for a link that was already consumed -- and if
      // an administrator removed the person afterwards it reports
      // hasAccess:false with a null role. Redirecting on status alone would
      // announce "You are in" and then drop them into a workspace they cannot
      // open. Read what the server actually said.
      if (result?.hasAccess === false) {
        setPhase({ kind: 'NO_ACCESS' });
        return;
      }

      setPhase({ kind: 'DONE' });
      // A full load, not a client route change: the session's workspace list
      // has changed and everything on screen belongs to the previous context.
      window.location.assign('/dashboard');
    } catch (err: unknown) {
      setPhase({
        kind: 'FAILED',
        message:
          err instanceof ApiError
            ? err.message
            : 'That invitation could not be accepted.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#070913] text-slate-100 font-sans flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/60 p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-3">
          <MailCheck className="w-6 h-6 text-cyan-400 shrink-0" />
          <span>Join a workspace</span>
        </h1>

        {phase.kind === 'CHECKING' ? (
          <p className="text-sm text-slate-400 mt-4">Checking your link...</p>
        ) : null}

        {phase.kind === 'NO_TOKEN' ? (
          <p className="text-sm text-slate-400 mt-4 leading-relaxed">
            This link is missing its invitation code. Ask whoever invited you to
            send the full link again.
          </p>
        ) : null}

        {phase.kind === 'NEEDS_SIGN_IN' ? (
          <>
            <p className="text-sm text-slate-400 mt-4 leading-relaxed">
              Sign in first, then open this link again. An invitation can only be
              accepted by the account it was sent to.
            </p>
            <button
              onClick={() => router.push('/')}
              className="mt-5 w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-semibold hover:from-cyan-400 hover:to-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:translate-y-px transition"
            >
              Go to sign in
            </button>
          </>
        ) : null}

        {phase.kind === 'READY' || phase.kind === 'WORKING' ? (
          <>
            <p className="text-sm text-slate-400 mt-4 leading-relaxed">
              You are signed in as{' '}
              <span className="text-slate-200 break-all">{me?.email}</span>. This
              invitation only works if it was sent to that address.
            </p>
            <button
              onClick={() => void accept()}
              disabled={phase.kind === 'WORKING'}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-semibold hover:from-cyan-400 hover:to-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {phase.kind === 'WORKING' ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : null}
              <span>Accept invitation</span>
            </button>
          </>
        ) : null}

        {phase.kind === 'NO_ACCESS' ? (
          <p className="text-sm text-slate-400 mt-4 leading-relaxed">
            This invitation was already used by your account, but you no longer
            have access to that workspace. Ask an administrator there to invite
            you again.
          </p>
        ) : null}

        {phase.kind === 'DONE' ? (
          <p className="text-sm text-emerald-300 mt-4">
            You are in. Taking you to the workspace...
          </p>
        ) : null}

        {phase.kind === 'FAILED' ? (
          <>
            <div
              role="alert"
              className="mt-4 p-3 rounded-xl border bg-rose-950/20 border-rose-500/30 text-rose-300 text-sm"
            >
              {phase.message}
            </div>
            <button
              onClick={() => setPhase({ kind: 'READY' })}
              className="mt-4 w-full py-3 rounded-xl border border-slate-700 text-slate-200 text-sm font-semibold hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 active:translate-y-px transition"
            >
              Try again
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * useSearchParams() opts the route into client-side rendering and Next requires
 * a Suspense boundary around it, or the whole page deoptimises to dynamic
 * rendering with a build warning.
 */
export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#070913] text-slate-400 flex items-center justify-center text-sm">
          Loading...
        </div>
      }
    >
      <InviteInner />
    </Suspense>
  );
}
