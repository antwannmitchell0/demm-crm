'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import { api, getAuthToken } from '../../lib/api';
import { 
  GitFork, 
  Plus, 
  TrendingUp, 
  DollarSign,
  User,
  Sparkles,
  ArrowRightLeft,
  RefreshCw
} from 'lucide-react';

export default function PipelinesPage() {
  const router = useRouter();
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAddOpp, setShowAddOpp] = useState(false);

  // New Opportunity fields
  const [oppName, setOppName] = useState('');
  const [oppValue, setOppValue] = useState('');
  const [oppProb, setOppProb] = useState('50');
  const [oppContact, setOppContact] = useState('');
  const [contacts, setContacts] = useState<any[]>([]);

  const fetchPipelines = async () => {
    try {
      const list = await api.getPipelines();
      setPipelines(list);
      if (list.length > 0) {
        // Load details of the first pipeline
        const details = await api.getPipeline(list[0].id);
        setSelectedPipeline(details);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchContacts = async () => {
    try {
      const list = await api.getContacts();
      setContacts(list);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }

    const init = async () => {
      await fetchPipelines();
      await fetchContacts();
      setLoading(false);
    };
    init();
  }, [router]);

  const handlePipelineSelect = async (id: string) => {
    setLoading(true);
    try {
      const details = await api.getPipeline(id);
      setSelectedPipeline(details);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOpp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPipeline || selectedPipeline.stages.length === 0) return;

    try {
      await api.createOpportunity({
        name: oppName,
        value: parseFloat(oppValue) || 0,
        probability: parseInt(oppProb) || 50,
        pipelineId: selectedPipeline.id,
        stageId: selectedPipeline.stages[0].id,
        contactId: oppContact || undefined,
      });

      setOppName('');
      setOppValue('');
      setOppProb('50');
      setOppContact('');
      setShowAddOpp(false);
      // Reload pipeline
      handlePipelineSelect(selectedPipeline.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleMoveOpp = async (oppId: string, targetStageId: string) => {
    try {
      await api.moveOpportunity(oppId, targetStageId);
      // Reload
      handlePipelineSelect(selectedPipeline.id);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-200 flex items-center justify-center font-mono">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mr-3" />
        LOADING WORKSPACE PIPELINES...
      </div>
    );
  }

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto flex flex-col">
        {/* Header */}
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Deals & Pipelines</h2>
            <div className="flex items-center space-x-3 mt-1.5">
              <select
                value={selectedPipeline?.id || ''}
                onChange={(e) => handlePipelineSelect(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
              >
                {pipelines.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={() => setShowAddOpp(!showAddOpp)}
            className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl font-semibold text-xs hover:from-cyan-400 hover:to-indigo-500 transition flex items-center space-x-2 text-white"
          >
            <Plus className="w-4 h-4" />
            <span>Create Deal</span>
          </button>
        </header>

        {/* Add Opportunity Form (Conditional) */}
        {showAddOpp && (
          <form onSubmit={handleCreateOpp} className="p-6 bg-slate-950/70 border border-slate-900 rounded-2xl mb-8 space-y-4 max-w-xl">
            <h3 className="text-sm font-bold tracking-wide uppercase text-slate-400">New Deal Opportunity</h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                required
                placeholder="Opportunity Name (e.g. Wedding Photo Booking)"
                value={oppName}
                onChange={(e) => setOppName(e.target.value)}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50"
              />
              <input
                type="number"
                required
                placeholder="Deal Value ($)"
                value={oppValue}
                onChange={(e) => setOppValue(e.target.value)}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="number"
                placeholder="Probability (%)"
                value={oppProb}
                onChange={(e) => setOppProb(e.target.value)}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50"
              />
              <select
                value={oppContact}
                onChange={(e) => setOppContact(e.target.value)}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 text-slate-400"
              >
                <option value="">Associate Contact</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowAddOpp(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 rounded-xl font-bold text-xs hover:bg-indigo-500 text-white"
              >
                Save Deal
              </button>
            </div>
          </form>
        )}

        {/* Pipelines Kanban Board */}
        <section className="flex-1 flex overflow-x-auto gap-6 pb-6 items-start min-h-[500px]">
          {selectedPipeline?.stages.map((stage: any) => {
            const stageOpps = selectedPipeline.opportunities.filter((o: any) => o.stageId === stage.id);
            const totalValue = stageOpps.reduce((sum: number, o: any) => sum + o.value, 0);

            return (
              <div key={stage.id} className="w-80 flex-shrink-0 bg-slate-950/40 border border-slate-900 rounded-3xl p-4 flex flex-col max-h-[600px] overflow-hidden">
                {/* Column Header */}
                <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-900">
                  <div>
                    <h4 className="font-bold text-sm tracking-wide text-slate-200">{stage.name}</h4>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">${totalValue.toLocaleString()} ({stageOpps.length})</p>
                  </div>
                </div>

                {/* Column Deal Cards */}
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {stageOpps.map((opp: any) => (
                    <div
                      key={opp.id}
                      className="p-4 bg-slate-900/60 border border-slate-850 hover:border-slate-800 rounded-2xl relative group transition duration-150"
                    >
                      <h5 className="font-bold text-xs text-slate-300">{opp.name}</h5>
                      <div className="flex justify-between items-center mt-3">
                        <div className="flex items-center text-[10px] font-bold text-cyan-400 font-mono">
                          <DollarSign className="w-3.5 h-3.5 text-cyan-500 mr-0.5" />
                          <span>{opp.value.toLocaleString()}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 font-mono">
                          {opp.probability}% Prob
                        </div>
                      </div>

                      {opp.contact && (
                        <div className="mt-2 text-[10px] text-slate-500 flex items-center space-x-1">
                          <User className="w-3 h-3 text-slate-600" />
                          <span>{opp.contact.firstName} {opp.contact.lastName}</span>
                        </div>
                      )}

                      {/* Transition Action selector */}
                      <div className="mt-3 pt-3 border-t border-slate-950 flex justify-between items-center">
                        <span className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">Move stage:</span>
                        <select
                          onChange={(e) => handleMoveOpp(opp.id, e.target.value)}
                          value={stage.id}
                          className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-400 focus:outline-none"
                        >
                          {selectedPipeline.stages.map((st: any) => (
                            <option key={st.id} value={st.id}>{st.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
