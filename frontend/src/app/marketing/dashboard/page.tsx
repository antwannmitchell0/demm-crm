'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../../components/Sidebar';
import { api, getAuthToken } from '../../../lib/api';
import {
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  Users,
  Clock,
  ShieldAlert,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';

const CLASSIFICATION_LABEL: Record<string, string> = {
  ACTUAL_VERIFIED: 'Verified',
  MANUALLY_RECORDED: 'Manually recorded',
  PROJECTED: 'Projected',
  ESTIMATED: 'Estimated',
  UNAVAILABLE: 'Not available',
};

const CLASSIFICATION_TONE: Record<string, string> = {
  ACTUAL_VERIFIED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  MANUALLY_RECORDED: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  PROJECTED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  ESTIMATED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  UNAVAILABLE: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
};

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function ClassificationBadge({ classification }: { classification: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${CLASSIFICATION_TONE[classification] ?? CLASSIFICATION_TONE.UNAVAILABLE}`}
    >
      {CLASSIFICATION_LABEL[classification] ?? classification}
    </span>
  );
}

function RevenueCard({ label, kpi }: { label: string; kpi: any }) {
  return (
    <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase">{label}</h4>
        <ClassificationBadge classification={kpi?.classification ?? 'UNAVAILABLE'} />
      </div>
      <p className="text-2xl font-extrabold text-slate-100">{fmt(kpi?.value)}</p>
      {kpi?.missingData?.length > 0 && (
        <p className="text-[9px] text-slate-600 mt-1">{kpi.missingData[0]}</p>
      )}
    </div>
  );
}

export default function MarketingDashboardPage() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    (async () => {
      try {
        const data = await api.getMarketingDashboard();
        setDashboard(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load dashboard.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-200 flex items-center justify-center font-mono">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mr-3" />
        LOADING DASHBOARD...
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="px-4 py-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-sm text-rose-300 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-rose-400" />
            <span>{error || 'No dashboard data available.'}</span>
          </div>
        </main>
      </div>
    );
  }

  const { revenueTrajectory, leadPipelineHealth, clientOperations, relationshipIntelligence } = dashboard;
  const targetProgress = revenueTrajectory.revenueTargetProgress?.value ?? 0;

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />
      <main className="flex-1 p-8 overflow-y-auto max-w-6xl mx-auto flex flex-col">
        <header className="mb-8">
          <h2 className="text-3xl font-extrabold tracking-tight">Marketing Dashboard</h2>
          <p className="text-sm text-slate-500 mt-1.5">
            Generated {new Date(dashboard.generatedAt).toLocaleString()}
          </p>
        </header>

        {/* --- Revenue Trajectory --- */}
        <section className="mb-8">
          <h3 className="text-xs font-mono font-bold tracking-wider text-slate-500 uppercase mb-3 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" /> Revenue Trajectory
          </h3>
          <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">$45,000 / 90-day target</span>
              <span className="text-lg font-extrabold text-cyan-400">{targetProgress}%</span>
            </div>
            <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-indigo-600"
                style={{ width: `${Math.min(100, targetProgress)}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <RevenueCard label="Collected (90d)" kpi={revenueTrajectory.collectedRevenue90d} />
            <RevenueCard label="MRR" kpi={revenueTrajectory.mrr} />
            <RevenueCard label="Projected Pipeline" kpi={revenueTrajectory.projectedPipelineRevenue} />
            <RevenueCard label="Avg Client Value" kpi={revenueTrajectory.averageClientValue} />
          </div>
          <div className="mt-4 p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
            <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">
              Founder-Tier Distribution
            </h4>
            <div className="flex gap-4">
              {Object.entries(revenueTrajectory.tierDistribution?.value ?? {}).map(([tier, count]) => (
                <div key={tier} className="text-center">
                  <p className="text-xl font-extrabold text-slate-100">{String(count)}</p>
                  <p className="text-[10px] text-slate-500">{tier}</p>
                </div>
              ))}
              {Object.keys(revenueTrajectory.tierDistribution?.value ?? {}).length === 0 && (
                <p className="text-xs text-slate-600">No clients yet.</p>
              )}
            </div>
          </div>
        </section>

        {/* --- Lead & Pipeline Health --- */}
        <section className="mb-8">
          <h3 className="text-xs font-mono font-bold tracking-wider text-slate-500 uppercase mb-3 flex items-center gap-2">
            <Users className="w-3.5 h-3.5" /> Lead &amp; Pipeline Health
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <p className="text-2xl font-extrabold text-slate-100">{leadPipelineHealth.newLeadsToday}</p>
              <p className="text-[10px] text-slate-500">New leads today</p>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <p className="text-2xl font-extrabold text-slate-100">{leadPipelineHealth.leadResponseBacklog?.value ?? '—'}</p>
              <p className="text-[10px] text-slate-500">Awaiting first response</p>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <p className="text-2xl font-extrabold text-rose-400">{leadPipelineHealth.leadsWithOverdueNextAction}</p>
              <p className="text-[10px] text-slate-500">Overdue next actions</p>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <p className="text-2xl font-extrabold text-amber-400">{leadPipelineHealth.stalledOpportunitiesCount}</p>
              <p className="text-[10px] text-slate-500">Stalled opportunities</p>
            </div>
          </div>
          {leadPipelineHealth.opportunitiesByStage?.length > 0 && (
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">Pipeline by Stage</h4>
              <div className="space-y-2">
                {leadPipelineHealth.opportunitiesByStage.map((s: any) => (
                  <div key={s.stageId} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{s.stageName}</span>
                    <span className="text-slate-500">{s.count} · {fmt(s.totalValue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* --- Client Operations --- */}
        <section className="mb-8">
          <h3 className="text-xs font-mono font-bold tracking-wider text-slate-500 uppercase mb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" /> Client Operations
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <p className="text-2xl font-extrabold text-slate-100">{clientOperations.pendingOnboardingCount}</p>
              <p className="text-[10px] text-slate-500">Pending onboarding</p>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <p className="text-2xl font-extrabold text-emerald-400">{clientOperations.launchReadyCount}</p>
              <p className="text-[10px] text-slate-500">Launch-ready</p>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <p className="text-2xl font-extrabold text-slate-100">{clientOperations.activeCount}</p>
              <p className="text-[10px] text-slate-500">Active clients</p>
            </div>
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <p className="text-2xl font-extrabold text-rose-400">{clientOperations.overdueDeliverables?.length ?? 0}</p>
              <p className="text-[10px] text-slate-500">Overdue deliverables</p>
            </div>
          </div>
          {clientOperations.commitmentsAtRisk?.length > 0 && (
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-amber-400 uppercase mb-2 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> Overdue Promises
              </h4>
              <div className="space-y-1">
                {clientOperations.commitmentsAtRisk.slice(0, 8).map((c: string, idx: number) => (
                  <p key={idx} className="text-xs text-slate-300">{c}</p>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* --- Relationship Intelligence --- */}
        <section className="mb-8">
          <h3 className="text-xs font-mono font-bold tracking-wider text-slate-500 uppercase mb-3 flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5" /> Relationship Intelligence
          </h3>
          {relationshipIntelligence.atRiskClients?.length > 0 ? (
            <div className="space-y-2">
              {relationshipIntelligence.atRiskClients.map((c: any) => (
                <div
                  key={c.clientAccountId}
                  onClick={() => router.push(`/marketing/clients/${c.clientAccountId}`)}
                  className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-900/60"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-200">{c.clientName}</p>
                    {c.recommendedAction && <p className="text-[10px] text-slate-500">{c.recommendedAction}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                        c.state === 'CRITICAL'
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}
                    >
                      {c.state}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <p className="text-xs text-slate-300">No clients currently at risk.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-center">
              <p className="text-lg font-extrabold text-slate-100">{relationshipIntelligence.activeRelationshipSignalsCount}</p>
              <p className="text-[10px] text-slate-500">Active relationship signals</p>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-center">
              <p className="text-lg font-extrabold text-slate-100">{relationshipIntelligence.memoriesAwaitingReconfirmationCount}</p>
              <p className="text-[10px] text-slate-500">Memories awaiting reconfirmation</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
