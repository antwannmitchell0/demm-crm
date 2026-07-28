'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, getAuthToken, getActiveUser, ApiError } from '../../lib/api';
import { acceptInvitationAndEnter } from '../../lib/session/client';
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
  // Holds an invitation but has no account at all. A distinct state, because
  // the ordinary sign-up form would found them an organization.
  | { kind: 'NEEDS_ACCOUNT' }
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
  const params = useSearchParams();
  const token = params.get('token');
  const [phase, setPhase] = useState<Phase>({ kind: 'CHECKING' });
  // Held in component state only, for the duration of one submit. Never
  // persisted, never logged, never put in the URL.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

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

  /**
   * The path for somebody who has no session and cannot get one: invited to
   * their first workspace, so no membership exists yet and no access token can
   * be minted for them. Accepting is what CREATES the membership, so it has to
   * come before the session, not after.
   *
   * Everything sensitive stays server-side -- see the BFF route. This component
   * sends a password once and receives a session, or an honest refusal.
   */
  const acceptWithCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setPhase({ kind: 'WORKING' });
    try {
      const result = await acceptInvitationAndEnter(email, password, token);
      setPassword('');
      if (!result.hasAccess) {
        setPhase({ kind: 'NO_ACCESS' });
        return;
      }
      setPhase({ kind: 'DONE' });
      window.location.assign('/dashboard');
    } catch (err: unknown) {
      setPassword('');
      setPhase({
        kind: 'FAILED',
        message:
          err instanceof Error
            ? err.message
            : 'That invitation could not be accepted.',
      });
    }
  };

  /**
   * Create the account, then immediately accept. Two server calls, one action:
   * asking somebody to fill a form, then sign in, then find the link again is
   * three chances to lose them, and the link is what they already have in hand.
   */
  const registerThenAccept = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setPhase({ kind: 'WORKING' });
    try {
      await api.registerInvited({
        token,
        email,
        passwordPlain: password,
        firstName,
        lastName,
      });
      const result = await acceptInvitationAndEnter(email, password, token);
      setPassword('');
      if (!result.hasAccess) {
        setPhase({ kind: 'NO_ACCESS' });
        return;
      }
      setPhase({ kind: 'DONE' });
      window.location.assign('/dashboard');
    } catch (err: unknown) {
      setPassword('');
      setPhase({
        kind: 'FAILED',
        message:
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'That invitation could not be accepted.',
      });
    }
  };

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
              Enter the password for the account this invitation was sent to.
              You will be taken straight into the workspace.
            </p>
            <form onSubmit={acceptWithCredentials} className="mt-5 space-y-3">
              <div>
                <label
                  htmlFor="invite-email"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Email address
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label
                  htmlFor="invite-password"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Password
                </label>
                <input
                  id="invite-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                  placeholder="Your password"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-semibold hover:from-cyan-400 hover:to-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:translate-y-px transition"
              >
                Accept invitation
              </button>
            </form>
            <p className="text-xs text-slate-500 mt-4 leading-relaxed">
              No account yet?{' '}
              <button
                onClick={() => setPhase({ kind: 'NEEDS_ACCOUNT' })}
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 rounded"
              >
                Create one here
              </button>
              . You will join this workspace, not start your own.
            </p>
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

        {phase.kind === 'NEEDS_ACCOUNT' ? (
          <>
            <p className="text-sm text-slate-400 mt-4 leading-relaxed">
              Create your account with the address this invitation was sent to.
              You will join the workspace that invited you.
            </p>
            <form onSubmit={registerThenAccept} className="mt-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="reg-first"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    First name
                  </label>
                  <input
                    id="reg-first"
                    required
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-last"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Last name
                  </label>
                  <input
                    id="reg-last"
                    required
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="reg-email"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Email address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label
                  htmlFor="reg-password"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Choose a password
                </label>
                <input
                  id="reg-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-semibold hover:from-cyan-400 hover:to-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:translate-y-px transition"
              >
                Create account and join
              </button>
            </form>
            <button
              onClick={() => setPhase({ kind: 'NEEDS_SIGN_IN' })}
              className="mt-4 text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 rounded"
            >
              I already have an account
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
