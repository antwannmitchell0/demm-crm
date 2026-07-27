'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import { api, getAuthToken, ApiError } from '../../lib/api';
import {
  classifyDashboard,
  WORKFLOW_COPY,
  type DashboardState,
} from '../../components/dashboard/dashboardState';
import {
  Users,
  TrendingUp,
  Clock,
  Briefcase,
  RefreshCw,
  Lock,
  CloudOff,
  Inbox,
  GitBranch,
} from 'lucide-react';

/**
 * T10 removed three things from this page that were not true:
 *
 *  1. An "Active Automated Playbooks" panel with a hard-coded failed workflow
 *     ("Atlanta Photo Booth"), an "AI Agent Self-Heal" button whose handler was
 *     a 2.5-second `setTimeout`, and a success message claiming an audit trail
 *     had been written. Nothing about it touched the backend.
 *  2. An "AI Summary & Recommendations" heading over `data.brief`. The brief is
 *     a template string the backend assembles from real counts -- there is no
 *     model involved, so calling it AI was a false claim about the product.
 *  3. An "ACTIVE TENANT SYSTEM SECURE" status badge, which reported a health
 *     state nothing measured.
 *
 * What stayed is what the backend genuinely returns: the five figures in
 * `stats`. `openDealsCount` is now shown too -- the backend was already
 * sending it and the UI simply ignored it.
 */
export default function Dashboard() {
  const router = useRouter();
  const [state, setState] = useState<DashboardState>({ kind: 'LOADING' });

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }

    let cancelled = false;

    const fetchDashboard = async () => {
      try {
        const data = await api.getDashboard();
        if (!cancelled) {
          setState(classifyDashboard({ loading: false, error: null, data }));
        }
      } catch (err) {
        // A failure is shown to the person, not swallowed into a console
        // message while the page renders zeros as if they were real.
        if (!cancelled) {
          setState(
            classifyDashboard({
              loading: false,
              error: {
                status: err instanceof ApiError ? err.status : undefined,
                message: err instanceof Error ? err.message : undefined,
              },
              data: null,
            }),
          );
        }
      }
    };

    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.kind === 'LOADING') {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-300 flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-cyan-400 mr-3" />
        <span className="text-sm">Loading your numbers...</span>
      </div>
    );
  }

  const stats = state.kind === 'READY' || state.kind === 'EMPTY' ? state.stats : null;

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto w-full">
        <header className="mb-8">
          <h2 className="text-3xl font-extrabold tracking-tight">
            Executive Brief
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Your numbers for this workspace, straight from your records.
          </p>
        </header>

        {/* --- Honest failure states. No numbers are shown at all here, --- */}
        {/* --- because we do not have any.                              --- */}
        {state.kind === 'FORBIDDEN' && (
          <section className="p-8 rounded-3xl border border-amber-500/20 bg-amber-950/10 flex items-start space-x-4">
            <Lock className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-slate-100">
                You do not have access to these numbers.
              </h3>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                Your account is signed in, but it is not allowed to see this
                workspace&apos;s dashboard. Ask an administrator if you think
                this is wrong.
              </p>
            </div>
          </section>
        )}

        {state.kind === 'UNAVAILABLE' && (
          <section className="p-8 rounded-3xl border border-rose-500/20 bg-rose-950/10 flex items-start space-x-4">
            <CloudOff className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-slate-100">
                We could not load your numbers.
              </h3>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                The server did not answer, so nothing is shown here. This is not
                the same as having no data &mdash; please try again shortly.
              </p>
              {state.detail && (
                <p className="text-xs text-slate-500 mt-3 font-mono break-words">
                  {state.detail}
                </p>
              )}
            </div>
          </section>
        )}

        {/* --- Real values. Zeros here are genuine zeros from the backend. --- */}
        {stats && (
          <>
            {state.kind === 'EMPTY' && (
              <section className="mb-8 p-6 rounded-3xl border border-slate-800 bg-slate-950/40 flex items-start space-x-4">
                <Inbox className="w-6 h-6 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-slate-200">
                    Nothing has happened in this workspace yet.
                  </h3>
                  <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                    These numbers are real and they are all zero. Add contacts
                    and deals and they will fill in.
                  </p>
                </div>
              </section>
            )}

            {/* Five across only on very wide screens: at 1280px the revenue
                figure was being truncated to "$1..." in a five-column row. */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-6 mb-8">
              <StatCard
                label="Leads added today"
                value={String(stats.leadsToday)}
                tone="text-cyan-400"
                bg="bg-cyan-950/40"
                icon={<Users className="w-6 h-6" />}
              />
              <StatCard
                label="Projected revenue"
                value={`$${stats.projectedRevenue.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}`}
                tone="text-indigo-400"
                bg="bg-indigo-950/40"
                icon={<TrendingUp className="w-6 h-6" />}
              />
              <StatCard
                label="Deals likely to close"
                value={String(stats.likelyToBookCount)}
                tone="text-teal-400"
                bg="bg-teal-950/40"
                icon={<Briefcase className="w-6 h-6" />}
              />
              <StatCard
                label="Open deals"
                value={String(stats.openDealsCount)}
                tone="text-sky-400"
                bg="bg-sky-950/40"
                icon={<GitBranch className="w-6 h-6" />}
              />
              <StatCard
                label="Needs follow-up"
                value={String(stats.needsFollowup)}
                tone="text-rose-400"
                bg="bg-rose-950/40"
                icon={<Clock className="w-6 h-6" />}
              />
            </section>
          </>
        )}

        {/* --- Where the fabricated panel used to be. --- */}
        <section className="p-6 bg-slate-950/40 border border-slate-900 rounded-3xl">
          <h3 className="font-bold text-base text-slate-200 mb-1">
            {WORKFLOW_COPY.heading}
          </h3>
          <p className="text-sm text-slate-400 leading-relaxed max-w-2xl">
            {WORKFLOW_COPY.detail}
          </p>
        </section>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  bg,
  icon,
}: {
  label: string;
  value: string;
  tone: string;
  bg: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-6 bg-slate-950/60 border border-slate-900 rounded-2xl flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold font-mono">
          {label}
        </p>
        <h4 className={`text-2xl xl:text-3xl font-black mt-2 truncate ${tone}`}>
          {value}
        </h4>
      </div>
      <div className={`p-3 ${bg} ${tone} rounded-xl shrink-0 ml-3`}>{icon}</div>
    </div>
  );
}
