'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import { api, getAuthToken } from '../../lib/api';
import { 
  Users, 
  TrendingUp, 
  Clock, 
  ShieldAlert,
  Sparkles,
  RefreshCw,
  CheckCircle,
  Briefcase
} from 'lucide-react';

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [healing, setHealing] = useState(false);
  const [healed, setHealed] = useState(false);

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }

    const fetchDashboard = async () => {
      try {
        const dashboard = await api.getDashboard();
        setData(dashboard);
      } catch (err) {
        console.error('Error fetching dashboard', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [router]);

  const handleSelfHeal = async () => {
    setHealing(true);
    // Simulate AI Agent executing healing tool
    setTimeout(() => {
      setHealing(false);
      setHealed(true);
    }, 2500);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-200 flex items-center justify-center font-mono">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-400 mr-3" />
        LOADING SYSTEM METRICS...
      </div>
    );
  }

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />
      
      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Executive Brief</h2>
            <p className="text-sm text-slate-400 mt-1">Operational outcomes and insights.</p>
          </div>
          <div className="flex items-center space-x-2 text-xs bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-slate-400 font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block mr-1"></span>
            ACTIVE TENANT SYSTEM SECURE
          </div>
        </header>

        {/* Executive Brief Card */}
        <section className="relative mb-8 p-8 rounded-3xl bg-gradient-to-r from-cyan-950/20 to-indigo-950/20 border border-cyan-500/10 shadow-xl overflow-hidden group">
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-cyan-400/10 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-500" />
          <div className="flex items-start space-x-4">
            <div className="p-3 bg-gradient-to-tr from-cyan-400 to-blue-500 rounded-2xl text-white shadow-lg">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div className="flex-1">
              <h3 className="font-extrabold text-lg text-slate-200 mb-2">AI Summary & Recommendations</h3>
              <div className="text-slate-300 leading-relaxed whitespace-pre-line text-sm max-w-3xl">
                {data?.brief}
              </div>
            </div>
          </div>
        </section>

        {/* KPI Grid */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {/* Card 1 */}
          <div className="p-6 bg-slate-950/60 border border-slate-900 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold font-mono">Leads Added Today</p>
              <h4 className="text-3xl font-black mt-2 text-cyan-400">{data?.stats?.leadsToday ?? 0}</h4>
            </div>
            <div className="p-3 bg-cyan-950/40 text-cyan-400 rounded-xl">
              <Users className="w-6 h-6" />
            </div>
          </div>

          {/* Card 2 */}
          <div className="p-6 bg-slate-950/60 border border-slate-900 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold font-mono">Projected Revenue</p>
              <h4 className="text-3xl font-black mt-2 text-indigo-400">
                ${data?.stats?.projectedRevenue ? data.stats.projectedRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 0}
              </h4>
            </div>
            <div className="p-3 bg-indigo-950/40 text-indigo-400 rounded-xl">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>

          {/* Card 3 */}
          <div className="p-6 bg-slate-950/60 border border-slate-900 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold font-mono">Highly Likely Deals</p>
              <h4 className="text-3xl font-black mt-2 text-teal-400">{data?.stats?.likelyToBookCount ?? 0}</h4>
            </div>
            <div className="p-3 bg-teal-950/40 text-teal-400 rounded-xl">
              <Briefcase className="w-6 h-6" />
            </div>
          </div>

          {/* Card 4 */}
          <div className="p-6 bg-slate-950/60 border border-slate-900 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold font-mono">Needs Follow-Up</p>
              <h4 className="text-3xl font-black mt-2 text-rose-400">{data?.stats?.needsFollowup ?? 0}</h4>
            </div>
            <div className="p-3 bg-rose-950/40 text-rose-400 rounded-xl">
              <Clock className="w-6 h-6" />
            </div>
          </div>
        </section>

        {/* Failed Automation Showcase */}
        <section className="p-6 bg-slate-950/40 border border-slate-900 rounded-3xl relative overflow-hidden">
          <h3 className="font-extrabold text-base mb-4 flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-rose-500" />
            <span>Active Automated Playbooks</span>
          </h3>

          {!healed ? (
            <div className="p-5 rounded-2xl border border-rose-500/20 bg-rose-950/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-rose-400">Trigger Alert: Atlanta Photo Booth Workflow Failed</p>
                <p className="text-xs text-slate-400 mt-1">
                  API timeout on third-party mailer delivery for pipeline stages.
                </p>
              </div>
              <button
                onClick={handleSelfHeal}
                disabled={healing}
                className="px-4 py-2.5 bg-gradient-to-r from-rose-600 to-orange-600 rounded-xl font-bold text-xs hover:opacity-90 transition flex items-center justify-center space-x-2 text-white"
              >
                {healing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Agent Repairing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI Agent Self-Heal</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="p-5 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 flex items-center space-x-3 text-emerald-400 text-sm font-semibold">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <span>All workflows resolved and healthy. (Agent audit trail logged)</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
