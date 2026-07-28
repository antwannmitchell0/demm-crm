'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import { api, getAuthToken, getActiveUser, ApiError } from '../../lib/api';
import { Users, Loader2, UserPlus, Copy, Trash2 } from 'lucide-react';

/**
 * Team management.
 *
 * Before this page existed a teammate could not be added at all: the
 * `Invitation` model was in the schema with nothing in the application
 * referencing it, and the only route to a second person in a workspace was
 * inserting a Membership row by hand.
 *
 * THE INVITE LINK IS SHOWN ONCE. The backend stores only a SHA-256 of the
 * token, so it cannot be retrieved again -- this page says so plainly rather
 * than letting someone close the panel and discover later that the invitation
 * is unusable. There is no email delivery in this build; the link is handed to
 * the administrator to send however they already communicate. Claiming an email
 * had been sent would be the fabrication this work exists to remove.
 */

interface Member {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  invitedByEmail: string | null;
}

type LoadState =
  | { kind: 'LOADING' }
  | { kind: 'READY'; members: Member[]; invitations: Invitation[] }
  | { kind: 'ERROR'; message: string };

const ASSIGNABLE_ROLES = [
  { value: 'USER', label: 'Member — can use the workspace' },
  { value: 'WORKSPACE_ADMIN', label: 'Workspace admin — can manage this workspace' },
  { value: 'ORG_ADMIN', label: 'Organization admin' },
  { value: 'ORG_OWNER', label: 'Owner — full control' },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export default function TeamPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'LOADING' });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('USER');
  const [inviting, setInviting] = useState(false);
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const me = getActiveUser();

  const load = useCallback(async () => {
    try {
      const [membersData, invitesData] = await Promise.all([
        api.getTeamMembers(),
        api.getTeamInvitations(),
      ]);
      setState({
        kind: 'READY',
        members: Array.isArray(membersData?.members) ? membersData.members : [],
        invitations: Array.isArray(invitesData?.invitations)
          ? invitesData.invitations.filter(
              (i: Invitation) => i.status === 'PENDING',
            )
          : [],
      });
    } catch (err: unknown) {
      setState({
        kind: 'ERROR',
        message:
          err instanceof ApiError
            ? err.message
            : 'Could not load your team right now.',
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

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIssuedLink(null);
    setCopied(false);
    setInviting(true);
    try {
      const created = await api.inviteTeamMember(inviteEmail.trim(), inviteRole);
      // The raw token comes back exactly once and is never recoverable.
      setIssuedLink(
        `${window.location.origin}/invite?token=${encodeURIComponent(created.token)}`,
      );
      setInviteEmail('');
      await load();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : 'That invitation was not created.',
      );
    } finally {
      setInviting(false);
    }
  };

  const act = async (id: string, run: () => Promise<unknown>) => {
    setError(null);
    setBusyId(id);
    try {
      await run();
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'That did not go through.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-6 sm:p-8 overflow-y-auto max-w-5xl mx-auto w-full space-y-8">
        <header>
          <h2 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
            <Users className="w-7 h-7 text-cyan-400 shrink-0" />
            <span>Your team</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Everyone who can open this workspace, and the invitations still
            outstanding.
          </p>
        </header>

        {error ? (
          <div
            role="alert"
            className="p-4 rounded-2xl border bg-rose-950/20 border-rose-500/30 text-rose-300 text-sm"
          >
            {error}
          </div>
        ) : null}

        {/* ---- Invite ---- */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
          <h3 className="text-base font-bold text-slate-100">Invite someone</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            This creates a one-time link. Nothing is emailed — send the link
            yourself. It can only be used by the address you enter here.
          </p>

          <form
            onSubmit={submitInvite}
            className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]"
          >
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@example.com"
              aria-label="Email address to invite"
              className="w-full min-w-0 px-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 transition"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              aria-label="Role for the invited person"
              className="w-full min-w-0 px-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl text-sm text-slate-100 focus:border-cyan-500/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 transition"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={inviting}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-semibold whitespace-nowrap hover:from-cyan-400 hover:to-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {inviting ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <UserPlus className="w-4 h-4 shrink-0" />
              )}
              <span>Create link</span>
            </button>
          </form>

          {issuedLink ? (
            <div className="mt-4 p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/10">
              <p className="text-xs font-semibold text-cyan-300">
                Copy this now — it is shown once and cannot be retrieved again.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 items-center">
                <code className="flex-1 min-w-0 text-xs text-slate-300 bg-black/40 border border-slate-800 rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap">
                  {issuedLink}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(issuedLink)
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false));
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 text-slate-200 text-xs font-semibold whitespace-nowrap hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 active:translate-y-px transition"
                >
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {state.kind === 'LOADING' ? (
          <div className="flex items-center gap-3 text-slate-400 text-sm p-6">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>Loading your team...</span>
          </div>
        ) : null}

        {state.kind === 'ERROR' ? (
          <div
            role="alert"
            className="p-6 rounded-2xl border border-rose-500/30 bg-rose-950/20"
          >
            <p className="text-sm text-rose-300">{state.message}</p>
          </div>
        ) : null}

        {/* ---- Members ---- */}
        {state.kind === 'READY' ? (
          <section className="space-y-3">
            <h3 className="text-base font-bold text-slate-100">
              Members ({state.members.length})
            </h3>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 divide-y divide-slate-900">
              {state.members.map((m) => {
                const isMe = me?.id === m.userId;
                const busy = busyId === m.userId;
                return (
                  <div
                    key={m.userId}
                    className="p-4 flex flex-wrap items-center gap-3 justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100 break-words">
                        {m.firstName} {m.lastName}
                        {isMe ? (
                          <span className="text-slate-500 font-normal"> (you)</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-slate-500 break-all">
                        {m.email} · joined {formatDate(m.joinedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={m.role}
                        disabled={busy}
                        aria-label={`Role for ${m.email}`}
                        onChange={(e) =>
                          void act(m.userId, () =>
                            api.changeMemberRole(m.userId, e.target.value),
                          )
                        }
                        className="px-3 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-200 focus:border-cyan-500/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:opacity-60 transition"
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.value}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(m.userId, () => api.removeMember(m.userId))
                        }
                        aria-label={`Remove ${m.email}`}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-300 text-xs font-semibold whitespace-nowrap hover:bg-rose-950/20 hover:text-rose-300 hover:border-rose-500/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed transition"
                      >
                        {busy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              A workspace always keeps at least one owner. Removing or demoting
              the only owner is refused, because nobody could administer the
              workspace afterwards.
            </p>
          </section>
        ) : null}

        {/* ---- Outstanding invitations ---- */}
        {state.kind === 'READY' && state.invitations.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-base font-bold text-slate-100">
              Waiting to be accepted ({state.invitations.length})
            </h3>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 divide-y divide-slate-900">
              {state.invitations.map((i) => (
                <div
                  key={i.id}
                  className="p-4 flex flex-wrap items-center gap-3 justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-200 break-all">
                      {i.email}
                    </p>
                    <p className="text-xs text-slate-500">
                      {i.role} · expires {formatDate(i.expiresAt)}
                      {i.invitedByEmail ? ` · invited by ${i.invitedByEmail}` : ''}
                    </p>
                  </div>
                  <button
                    disabled={busyId === i.id}
                    onClick={() =>
                      void act(i.id, () => api.revokeInvitation(i.id))
                    }
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-300 text-xs font-semibold whitespace-nowrap hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    {busyId === i.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : null}
                    <span>Revoke</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
