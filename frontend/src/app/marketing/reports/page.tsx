'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '../../../components/Sidebar';
import { api, getAuthToken } from '../../../lib/api';
import { RefreshCw, AlertTriangle, FileBarChart, Printer } from 'lucide-react';

function ReportsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get('clientId');

  const [tab, setTab] = useState<'internal' | 'client'>(clientIdParam ? 'client' : 'internal');
  const [internalReport, setInternalReport] = useState<any>(null);
  const [clientReport, setClientReport] = useState<any>(null);
  const [clientIdInput, setClientIdInput] = useState(clientIdParam || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    (async () => {
      try {
        const internal = await api.getInternalReport();
        setInternalReport(internal);
        if (clientIdParam) {
          const client = await api.getClientReport(clientIdParam);
          setClientReport(client);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load reports.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router, clientIdParam]);

  const loadClientReport = async () => {
    if (!clientIdInput) return;
    setError(null);
    try {
      const client = await api.getClientReport(clientIdInput);
      setClientReport(client);
      router.push(`/marketing/reports?clientId=${clientIdInput}`);
    } catch (err: any) {
      setError(err.message || 'Failed to load client report -- check the Client Account ID.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-200 flex items-center justify-center font-mono">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mr-3" />
        LOADING REPORTS...
      </div>
    );
  }

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans print:bg-white print:text-black">
      <div className="print:hidden">
        <Sidebar />
      </div>
      <main className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto flex flex-col">
        <header className="mb-6 flex items-center justify-between print:hidden">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Reports</h2>
            <p className="text-sm text-slate-500 mt-1.5">
              Internal operating report and client-safe progress reports.
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300 flex items-center gap-2 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <Printer className="w-3.5 h-3.5" /> Print / Export
          </button>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-6 px-4 py-3 bg-rose-950/40 border border-rose-800/60 rounded-xl flex items-start gap-3 text-sm text-rose-300 print:hidden"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-rose-400" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        <nav className="flex gap-1 mb-6 border-b border-slate-900 print:hidden">
          <button
            onClick={() => setTab('internal')}
            className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${
              tab === 'internal' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            Internal Operating Report
          </button>
          <button
            onClick={() => setTab('client')}
            className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${
              tab === 'client' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            Client-Facing Report
          </button>
        </nav>

        {tab === 'internal' && internalReport && (
          <div className="space-y-4">
            <p className="text-[10px] text-slate-500 font-mono print:hidden">
              Generated {new Date(internalReport.generatedAt).toLocaleString()}
            </p>

            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl print:border-slate-300">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">Revenue Trajectory</h4>
              <p className="text-xs text-slate-300">
                Collected (90d): ${Number(internalReport.revenueTrajectory.collectedRevenue90d.value).toLocaleString()} ({internalReport.revenueTrajectory.collectedRevenue90d.classification})
              </p>
              <p className="text-xs text-slate-300">
                MRR: ${Number(internalReport.revenueTrajectory.mrr.value).toLocaleString()} ({internalReport.revenueTrajectory.mrr.classification})
              </p>
            </div>

            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl print:border-slate-300">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">At-Risk Clients</h4>
              {internalReport.atRiskClients.length > 0 ? (
                internalReport.atRiskClients.map((c: any) => (
                  <p key={c.clientAccountId} className="text-xs text-slate-300">
                    {c.clientName} -- {c.state} -- {c.recommendedAction}
                  </p>
                ))
              ) : (
                <p className="text-xs text-slate-600">No clients currently at risk.</p>
              )}
            </div>

            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl print:border-slate-300">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">Operational Blockers</h4>
              {internalReport.operationalBlockers.length > 0 ? (
                internalReport.operationalBlockers.map((b: any, idx: number) => (
                  <p key={idx} className="text-xs text-slate-300">{b.clientName}: {b.blockedItems} blocked item(s)</p>
                ))
              ) : (
                <p className="text-xs text-slate-600">No operational blockers.</p>
              )}
            </div>

            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl print:border-slate-300">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-amber-400 uppercase mb-2">System Limitations</h4>
              {internalReport.systemLimitations.map((l: string, idx: number) => (
                <p key={idx} className="text-xs text-slate-400 mb-1">{l}</p>
              ))}
            </div>
          </div>
        )}

        {tab === 'client' && (
          <div className="space-y-4">
            <div className="flex gap-2 print:hidden">
              <input
                type="text"
                placeholder="Client Account ID"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <button
                onClick={loadClientReport}
                className="px-4 py-2 bg-indigo-600 rounded-xl font-bold text-xs text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                Load Report
              </button>
            </div>

            {clientReport && (
              <>
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl print:border-slate-300">
                  <h3 className="text-lg font-extrabold text-slate-100 flex items-center gap-2">
                    <FileBarChart className="w-4 h-4" /> {clientReport.clientName}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {clientReport.purchased.planName} -- ${Number(clientReport.purchased.price).toLocaleString()}/mo
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Service period: {new Date(clientReport.servicePeriod.startedAt).toLocaleDateString()} through {new Date(clientReport.servicePeriod.coveredThrough).toLocaleDateString()}
                  </p>
                </div>

                {clientReport.dataAvailabilityNote && (
                  <div className="px-4 py-3 bg-amber-500/5 border border-amber-500/20 rounded-xl text-xs text-amber-400">
                    {clientReport.dataAvailabilityNote}
                  </div>
                )}

                {[
                  { title: 'Work Completed', items: clientReport.workCompleted },
                  { title: 'Work In Progress', items: clientReport.workInProgress },
                  { title: 'Waiting On Client', items: clientReport.waitingOnClient },
                  { title: 'Waiting On DEMM', items: clientReport.waitingOnDemm },
                  { title: 'Blockers', items: clientReport.blockers },
                  { title: 'Evidence & Deliverables', items: clientReport.evidenceAndDeliverables },
                ].map((section) => (
                  <div key={section.title} className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl print:border-slate-300">
                    <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">{section.title}</h4>
                    {section.items.length > 0 ? (
                      section.items.map((item: any, idx: number) => (
                        <p key={idx} className="text-xs text-slate-300">{item.description}</p>
                      ))
                    ) : (
                      <p className="text-xs text-slate-600">None.</p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070913]" />}>
      <ReportsPageInner />
    </Suspense>
  );
}
