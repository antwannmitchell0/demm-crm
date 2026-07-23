'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api, getActiveUser } from '../lib/api';
import { RefreshCw, ShieldAlert, History } from 'lucide-react';

const OVERRIDE_ALLOWED_ROLES = ['SUPERADMIN', 'ORG_OWNER', 'ORG_ADMIN', 'WORKSPACE_ADMIN'];

const HEALTH_STATES = ['HEALTHY', 'WATCH', 'AT_RISK', 'CRITICAL', 'PAUSED', 'CHURNED', 'UNKNOWN'];

const STATE_TONE: Record<string, string> = {
  HEALTHY: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  WATCH: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  AT_RISK: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  CRITICAL: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  PAUSED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  CHURNED: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  UNKNOWN: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
};

const RISK_OWNER_TONE: Record<string, string> = {
  DEMM: 'text-cyan-400',
  CLIENT: 'text-amber-400',
  COMMERCIAL: 'text-fuchsia-400',
  RELATIONSHIP: 'text-indigo-400',
  DELIVERY: 'text-rose-400',
};

export default function ClientHealthTab({ clientAccountId }: { clientAccountId: string }) {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideState, setOverrideState] = useState('HEALTHY');
  const [overrideReason, setOverrideReason] = useState('');
  const [submittingOverride, setSubmittingOverride] = useState(false);

  const currentUser = getActiveUser();
  const canOverride = currentUser && OVERRIDE_ALLOWED_ROLES.includes(currentUser.role);

  const load = useCallback(async () => {
    try {
      const data = await api.getClientHealth(clientAccountId);
      setHealth(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load Client Health.');
    }
  }, [clientAccountId]);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    setError(null);
    try {
      await api.recalculateClientHealth(clientAccountId);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to recalculate Client Health.');
    } finally {
      setRecalculating(false);
    }
  };

  const handleOverride = async () => {
    setSubmittingOverride(true);
    setError(null);
    try {
      await api.overrideClientHealth(clientAccountId, { state: overrideState, reason: overrideReason });
      setShowOverrideForm(false);
      setOverrideReason('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to override Client Health.');
    } finally {
      setSubmittingOverride(false);
    }
  };

  const handleClearOverride = async () => {
    setError(null);
    try {
      await api.clearClientHealthOverride(clientAccountId);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to clear override.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading Client Health...
      </div>
    );
  }

  if (!health) {
    return (
      <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
        <p className="text-xs text-slate-500 mb-3">No Client Health assessment yet.</p>
        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          className="px-4 py-2 bg-indigo-600 rounded-xl font-bold text-xs text-white disabled:opacity-50 hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          {recalculating ? 'Calculating...' : 'Calculate Now'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="px-4 py-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold border ${STATE_TONE[health.state] ?? STATE_TONE.UNKNOWN}`}
          >
            {health.state}
          </span>
          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            className="text-[10px] font-bold text-slate-400 hover:text-slate-200 flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${recalculating ? 'animate-spin' : ''}`} /> Recalculate
          </button>
        </div>
        {health.overrideState && (
          <p className="text-[10px] text-amber-400 mb-2">
            Overridden from computed state: {health.computedState}
          </p>
        )}
        {health.recommendedAction && (
          <p className="text-xs text-slate-300">{health.recommendedAction}</p>
        )}
        <p className="text-[9px] text-slate-600 mt-2">
          Calculated {new Date(health.calculatedAt).toLocaleString()}
        </p>
      </div>

      <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
        <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2 flex items-center gap-1">
          <ShieldAlert className="w-3 h-3" /> Contributing Factors
        </h4>
        {health.factors?.length > 0 ? (
          <div className="space-y-2">
            {health.factors.map((f: any, idx: number) => (
              <div key={idx} className="text-xs border-l-2 border-slate-800 pl-2">
                <p className="text-slate-300">{f.description}</p>
                <p className={`text-[9px] ${RISK_OWNER_TONE[f.riskOwner] ?? 'text-slate-500'}`}>
                  {f.riskOwner} · {f.evidence}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600">No risk factors currently present.</p>
        )}
      </div>

      {health.missingData?.length > 0 && (
        <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
          <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">
            Missing Data
          </h4>
          {health.missingData.map((m: string, idx: number) => (
            <p key={idx} className="text-xs text-slate-500">{m}</p>
          ))}
        </div>
      )}

      {canOverride && (
        <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
          <div className="flex items-center justify-between">
            <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase">
              Human Override
            </h4>
            {health.overrideState && (
              <button onClick={handleClearOverride} className="text-[10px] font-bold text-slate-400 hover:text-slate-200">
                Clear Override
              </button>
            )}
          </div>
          {!showOverrideForm ? (
            <button
              onClick={() => setShowOverrideForm(true)}
              className="mt-2 px-4 py-2 bg-amber-600/80 rounded-xl font-bold text-xs text-white hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              Override State
            </button>
          ) : (
            <div className="mt-2 space-y-2">
              <select
                value={overrideState}
                onChange={(e) => setOverrideState(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300"
              >
                {HEALTH_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <textarea
                placeholder="Reason for override (required)"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300"
              />
              <button
                onClick={handleOverride}
                disabled={submittingOverride || !overrideReason.trim()}
                className="px-4 py-2 bg-amber-600 rounded-xl font-bold text-xs text-white disabled:opacity-40 hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                {submittingOverride ? 'Saving...' : 'Confirm Override'}
              </button>
            </div>
          )}
        </div>
      )}

      {health.overrides?.length > 0 && (
        <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
          <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2 flex items-center gap-1">
            <History className="w-3 h-3" /> Override History
          </h4>
          {health.overrides.map((o: any) => (
            <p key={o.id} className="text-xs text-slate-400">
              {new Date(o.createdAt).toLocaleDateString()}: set to {o.state} -- {o.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
