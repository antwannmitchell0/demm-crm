'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../../components/Sidebar';
import { api, getAuthToken } from '../../../lib/api';
import {
  UserPlus,
  Plus,
  RefreshCw,
  AlertTriangle,
  X,
  ChevronRight,
} from 'lucide-react';

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  createdAt: string;
  company: { name: string; industry: string | null } | null;
  owner: { firstName: string; lastName: string } | null;
  tasks: { title: string }[];
  opportunities: {
    value: string | number;
    source: string | null;
    industryContext: string | null;
    stage: { name: string };
  }[];
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  companyName: '',
  industryContext: '',
  source: '',
  pipelineId: '',
  stageId: '',
  expectedValue: '',
};

function ageFromNow(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchLeads = async () => {
    try {
      const list = await api.getLeads();
      setLeads(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load leads.');
    }
  };

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    (async () => {
      await fetchLeads();
      try {
        const list = await api.getPipelines();
        setPipelines(list);
        if (list.length > 0) {
          const details = await api.getPipeline(list[0].id);
          setSelectedPipeline(details);
          setForm((f) => ({
            ...f,
            pipelineId: details.id,
            stageId: details.stages[0]?.id || '',
          }));
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load pipelines.');
      }
      setLoading(false);
    })();
  }, [router]);

  const handlePipelineChange = async (pipelineId: string) => {
    try {
      const details = await api.getPipeline(pipelineId);
      setSelectedPipeline(details);
      setForm((f) => ({ ...f, pipelineId, stageId: details.stages[0]?.id || '' }));
    } catch (err: any) {
      setError(err.message || 'Failed to load pipeline stages.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createLead({
        firstName: form.firstName,
        lastName: form.lastName,
        emails: form.email ? [form.email] : [],
        phones: form.phone ? [form.phone] : [],
        companyName: form.companyName || undefined,
        industryContext: form.industryContext || undefined,
        source: form.source || undefined,
        pipelineId: form.pipelineId,
        stageId: form.stageId,
        expectedValue: parseFloat(form.expectedValue) || 0,
      });
      await fetchLeads();
      setForm((f) => ({ ...EMPTY_FORM, pipelineId: f.pipelineId, stageId: f.stageId }));
      setShowForm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create lead.');
    } finally {
      setSaving(false);
    }
  };

  const goToContact = (contactId: string) => {
    router.push(`/contacts?contactId=${contactId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-200 flex items-center justify-center font-mono">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mr-3" />
        LOADING LEADS...
      </div>
    );
  }

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto flex flex-col">
        <header className="mb-8 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Leads</h2>
            <p className="text-sm text-slate-500 mt-1.5">
              {leads.length} open lead{leads.length === 1 ? '' : 's'}. Converted leads move to Clients.
            </p>
          </div>

          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl font-semibold text-xs hover:from-cyan-400 hover:to-indigo-500 transition flex items-center space-x-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 focus-visible:outline-offset-2"
          >
            <Plus className="w-4 h-4" />
            <span>New Lead</span>
          </button>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-6 px-4 py-3 bg-rose-950/40 border border-rose-800/60 rounded-xl flex items-start gap-3 text-sm text-rose-300"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-rose-400" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="text-rose-400 hover:text-rose-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="p-6 bg-slate-950/70 border border-slate-900 rounded-2xl mb-8 space-y-4 max-w-xl"
          >
            <h3 className="text-sm font-bold tracking-wide uppercase text-slate-400">New Lead</h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                required
                placeholder="First Name"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <input
                type="text"
                required
                placeholder="Last Name"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <input
                type="text"
                placeholder="Phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="Company (optional)"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <input
                type="text"
                placeholder="Industry / qualification context"
                value={form.industryContext}
                onChange={(e) => setForm({ ...form, industryContext: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="Acquisition source (e.g. referral)"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="Expected value ($)"
                value={form.expectedValue}
                onChange={(e) => setForm({ ...form, expectedValue: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <select
                value={form.pipelineId}
                onChange={(e) => handlePipelineChange(e.target.value)}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 text-slate-300"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={form.stageId}
                onChange={(e) => setForm({ ...form, stageId: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 text-slate-300"
              >
                {selectedPipeline?.stages.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form.pipelineId || !form.stageId}
                className="px-4 py-2 bg-indigo-600 rounded-xl font-bold text-xs hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                {saving ? 'Saving...' : 'Create Lead'}
              </button>
            </div>
          </form>
        )}

        {leads.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-24 border border-dashed border-slate-900 rounded-3xl">
            <UserPlus className="w-10 h-10 text-slate-700 mb-4" />
            <p className="text-slate-400 font-medium">No open leads.</p>
            <p className="text-slate-600 text-sm mt-1">
              Create a lead to start the journey toward a converted client.
            </p>
          </div>
        ) : (
          <div className="bg-slate-950/40 border border-slate-900 rounded-3xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-900 text-[10px] uppercase font-mono tracking-wider text-slate-500 bg-slate-950/60">
                  <th className="px-5 py-4">Name</th>
                  <th className="px-5 py-4">Company</th>
                  <th className="px-5 py-4">Source</th>
                  <th className="px-5 py-4">Industry</th>
                  <th className="px-5 py-4">Stage</th>
                  <th className="px-5 py-4">Value</th>
                  <th className="px-5 py-4">Owner</th>
                  <th className="px-5 py-4">Next Action</th>
                  <th className="px-5 py-4">Age</th>
                  <th className="px-5 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/60">
                {leads.map((lead) => {
                  const opp = lead.opportunities[0];
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => goToContact(lead.id)}
                      className="hover:bg-slate-900/40 cursor-pointer transition-colors duration-150"
                    >
                      <td className="px-5 py-4 text-sm font-semibold text-slate-200 whitespace-nowrap">
                        {lead.firstName} {lead.lastName}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400 whitespace-nowrap">
                        {lead.company?.name || '—'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400 whitespace-nowrap">
                        {opp?.source || '—'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400 whitespace-nowrap">
                        {lead.company?.industry || opp?.industryContext || '—'}
                      </td>
                      <td className="px-5 py-4 text-xs whitespace-nowrap">
                        {opp?.stage ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                            {opp.stage.name}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-emerald-400 whitespace-nowrap">
                        {opp ? `$${Number(opp.value).toLocaleString()}` : '—'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400 whitespace-nowrap">
                        {lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : 'Unassigned'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-400 whitespace-nowrap">
                        {lead.tasks[0]?.title || 'None'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">
                        {ageFromNow(lead.createdAt)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <ChevronRight className="w-4 h-4 text-slate-600 inline" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
