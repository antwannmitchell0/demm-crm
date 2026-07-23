'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Sidebar from '../../../../components/Sidebar';
import { api, getAuthToken, getActiveUser } from '../../../../lib/api';
import {
  RefreshCw,
  AlertTriangle,
  X,
  CheckCircle2,
  Circle,
  Clock,
  ShieldAlert,
  FileText,
  Sparkles,
} from 'lucide-react';

const OVERRIDE_ALLOWED_ROLES = [
  'SUPERADMIN',
  'ORG_OWNER',
  'ORG_ADMIN',
  'WORKSPACE_ADMIN',
];

type Tab = 'overview' | 'onboarding' | 'delivery' | 'memory';

const CHECKLIST_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'WAITING_ON_CLIENT',
  'BLOCKED',
  'SUBMITTED',
  'COMPLETE',
  'WAIVED',
  'CANCELLED',
];

const DELIVERABLE_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'BLOCKED',
  'WAITING_ON_CLIENT',
  'DELIVERED',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
];

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'COMPLETE' || status === 'ACCEPTED' || status === 'ACTIVE'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : status === 'BLOCKED' || status === 'REJECTED'
        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
        : status === 'WAITING_ON_CLIENT'
          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          : status === 'WAIVED' || status === 'CANCELLED'
            ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
            : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function ChecklistItemRow({
  item,
  onUpdate,
}: {
  item: any;
  onUpdate: (itemId: string, data: any) => Promise<void>;
}) {
  const [status, setStatus] = useState(item.status);
  const [blockerReason, setBlockerReason] = useState(item.blockerReason || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onUpdate(item.id, {
        status,
        blockerReason: status === 'BLOCKED' ? blockerReason : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const overdue =
    item.dueDate &&
    new Date(item.dueDate) < new Date() &&
    !['COMPLETE', 'WAIVED', 'CANCELLED'].includes(item.status);

  return (
    <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-xs font-semibold text-slate-200">{item.title}</p>
          {item.required && (
            <span className="text-[9px] text-rose-400 font-bold uppercase">Required</span>
          )}
          {overdue && (
            <span className="ml-2 text-[9px] text-rose-400 font-bold uppercase">Overdue</span>
          )}
        </div>
        <StatusBadge status={item.status} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[10px] text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          {CHECKLIST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        {status === 'BLOCKED' && (
          <input
            type="text"
            placeholder="Blocker reason"
            value={blockerReason}
            onChange={(e) => setBlockerReason(e.target.value)}
            className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[10px] text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          />
        )}
        <button
          onClick={submit}
          disabled={saving || status === item.status}
          className="px-2.5 py-1.5 bg-indigo-600 rounded-lg text-[10px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          {saving ? '...' : 'Save'}
        </button>
      </div>
      {item.evidence && (
        <p className="text-[9px] text-slate-500">Evidence: {item.evidence}</p>
      )}
    </div>
  );
}

function DeliverableRow({
  deliverable,
  onUpdate,
}: {
  deliverable: any;
  onUpdate: (id: string, data: any) => Promise<void>;
}) {
  const [status, setStatus] = useState(deliverable.status);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onUpdate(deliverable.id, { status });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-xs font-semibold text-slate-200 flex items-center gap-2">
            {deliverable.name}
            {deliverable.outsideScope && (
              <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20">
                OUTSIDE SCOPE
              </span>
            )}
          </p>
          <p className="text-[9px] text-slate-500">
            {deliverable.cadence}
            {deliverable.cadenceDetail ? ` · ${deliverable.cadenceDetail}` : ' · cadence detail not yet defined'}
          </p>
        </div>
        <StatusBadge status={deliverable.status} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[10px] text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          {DELIVERABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <button
          onClick={submit}
          disabled={saving || status === deliverable.status}
          className="px-2.5 py-1.5 bg-indigo-600 rounded-lg text-[10px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          {saving ? '...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function ClientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;

  const [tab, setTab] = useState<Tab>('overview');
  const [detail, setDetail] = useState<any>(null);
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [outsideScopeForm, setOutsideScopeForm] = useState({
    name: '',
    description: '',
    cadence: 'ONE_TIME',
  });

  const currentUser = getActiveUser();
  const canOverride = currentUser && OVERRIDE_ALLOWED_ROLES.includes(currentUser.role);

  const load = useCallback(async () => {
    try {
      const [d, deliv] = await Promise.all([
        api.getClientDetail(clientId),
        api.getDeliverables(clientId).catch(() => []),
      ]);
      setDetail(d);
      setDeliverables(deliv);
    } catch (err: any) {
      setError(err.message || 'Failed to load client account.');
    }
  }, [clientId]);

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [router, load]);

  const handleItemUpdate = async (itemId: string, data: any) => {
    setError(null);
    try {
      await api.updateChecklistItem(clientId, itemId, data);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to update checklist item.');
    }
  };

  const handleDeliverableUpdate = async (deliverableId: string, data: any) => {
    setError(null);
    try {
      await api.updateDeliverable(clientId, deliverableId, data);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to update deliverable.');
    }
  };

  const handleActivate = async (withOverride: boolean) => {
    setActivating(true);
    setError(null);
    try {
      await api.activateClient(
        clientId,
        withOverride ? { override: { reason: overrideReason } } : {},
      );
      setShowOverrideForm(false);
      setOverrideReason('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to activate client.');
    } finally {
      setActivating(false);
    }
  };

  const handleOutsideScopeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createOutsideScopeDeliverable(clientId, {
        name: outsideScopeForm.name,
        description: outsideScopeForm.description || undefined,
        cadence: outsideScopeForm.cadence,
      });
      setOutsideScopeForm({ name: '', description: '', cadence: 'ONE_TIME' });
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create outside-scope request.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-200 flex items-center justify-center font-mono">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mr-3" />
        LOADING CLIENT ACCOUNT...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-200 flex items-center justify-center font-mono">
        Client account not found.
      </div>
    );
  }

  const onboarding = detail.onboarding;
  const requiredItems = onboarding?.items?.filter((i: any) => i.required) ?? [];
  const nextAction = requiredItems.find(
    (i: any) => !['COMPLETE', 'WAIVED', 'CANCELLED'].includes(i.status),
  );
  const demmItems = onboarding?.items?.filter((i: any) => i.responsibility === 'DEMM') ?? [];
  const clientItems = onboarding?.items?.filter((i: any) => i.responsibility === 'CLIENT') ?? [];
  const contactName = detail.company?.name || `${detail.primaryContact?.firstName ?? ''} ${detail.primaryContact?.lastName ?? ''}`.trim();

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto flex flex-col">
        <header className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight">{contactName || 'Client Account'}</h2>
              <p className="text-sm text-slate-500 mt-1.5">
                {detail.offerSnapshot?.name} · ${Number(detail.offerSnapshot?.price).toLocaleString()}/mo · snapshot v{detail.offerSnapshot?.offerVersion}
              </p>
            </div>
            <StatusBadge status={detail.serviceStatus} />
          </div>
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

        <nav className="flex gap-1 mb-6 border-b border-slate-900">
          {(['overview', 'onboarding', 'delivery', 'memory'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                tab === t
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {t === 'overview'
                ? 'Overview'
                : t === 'onboarding'
                  ? 'Onboarding'
                  : t === 'delivery'
                    ? 'Service Delivery'
                    : 'Memory & Relationship'}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
                <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">
                  Commercial State
                </h4>
                <p className="text-xs text-slate-300">
                  Contract: {detail.currentCommercialState?.contractState || 'Not recorded'}
                </p>
                <p className="text-xs text-slate-300">
                  Payment: {detail.currentCommercialState?.paymentState || 'Not recorded'}
                </p>
              </div>
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
                <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">
                  Launch
                </h4>
                <p className="text-xs text-slate-300">
                  Target: {onboarding?.targetLaunchDate ? new Date(onboarding.targetLaunchDate).toLocaleDateString() : 'To be confirmed'}
                </p>
                <p className="text-xs text-slate-300">
                  Actual: {onboarding?.actualLaunchDate ? new Date(onboarding.actualLaunchDate).toLocaleDateString() : 'Not yet launched'}
                </p>
              </div>
            </div>

            {onboarding && (
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase">
                    Onboarding Progress
                  </h4>
                  <span className="text-xs font-bold text-cyan-400">{onboarding.progressPercentage}%</span>
                </div>
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-indigo-600"
                    style={{ width: `${onboarding.progressPercentage}%` }}
                  />
                </div>
                {nextAction && (
                  <p className="text-xs text-slate-400 mt-3">
                    Next action ({nextAction.responsibility === 'DEMM' ? 'DEMM owes' : 'Client owes'}): {nextAction.title}
                  </p>
                )}
                {onboarding.blockers?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-800">
                    <h5 className="text-[9px] font-mono font-bold tracking-wider text-rose-400 uppercase mb-1 flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" /> Blockers
                    </h5>
                    {onboarding.blockers.map((b: any) => (
                      <p key={b.id} className="text-xs text-slate-400">
                        {b.title}: {b.blockerReason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2 flex items-center gap-1">
                <FileText className="w-3 h-3" /> Relationship Brief
              </h4>
              {detail.brief ? (
                <p className="text-xs text-slate-300">{detail.brief.briefText}</p>
              ) : (
                <p className="text-xs text-slate-600">No relationship brief generated yet.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'onboarding' && onboarding && (
          <div className="space-y-6">
            <div
              className={`p-4 rounded-2xl border ${
                onboarding.launchReadiness
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-amber-500/5 border-amber-500/20'
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                  {onboarding.launchReadiness ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Circle className="w-4 h-4 text-amber-400" />
                  )}
                  {onboarding.launchReadiness
                    ? 'Ready for launch -- all required items complete.'
                    : `${requiredItems.filter((i: any) => !['COMPLETE', 'WAIVED'].includes(i.status)).length} required item(s) remaining.`}
                </p>
                {detail.serviceStatus === 'PENDING_ONBOARDING' && (
                  <div className="flex items-center gap-2">
                    {onboarding.launchReadiness ? (
                      <button
                        onClick={() => handleActivate(false)}
                        disabled={activating}
                        className="px-4 py-2 bg-emerald-600 rounded-xl font-bold text-xs text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                      >
                        {activating ? 'Activating...' : 'Activate Client'}
                      </button>
                    ) : canOverride ? (
                      <button
                        onClick={() => setShowOverrideForm(!showOverrideForm)}
                        className="px-4 py-2 bg-amber-600/80 rounded-xl font-bold text-xs text-white hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                      >
                        Override & Activate
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              {showOverrideForm && (
                <div className="mt-3 pt-3 border-t border-amber-500/20 space-y-2">
                  <textarea
                    placeholder="Reason for launch-gate override (required)"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                    rows={2}
                  />
                  <button
                    onClick={() => handleActivate(true)}
                    disabled={activating || !overrideReason.trim()}
                    className="px-4 py-2 bg-amber-600 rounded-xl font-bold text-xs text-white disabled:opacity-40 hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                  >
                    {activating ? 'Activating...' : 'Confirm Override & Activate'}
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">
                  DEMM Owes
                </h4>
                <div className="space-y-2">
                  {demmItems.map((item: any) => (
                    <ChecklistItemRow key={item.id} item={item} onUpdate={handleItemUpdate} />
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2">
                  Client Owes
                </h4>
                <div className="space-y-2">
                  {clientItems.map((item: any) => (
                    <ChecklistItemRow key={item.id} item={item} onUpdate={handleItemUpdate} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'delivery' && (
          <div className="space-y-6">
            <div className="space-y-2">
              {deliverables.map((d) => (
                <DeliverableRow key={d.id} deliverable={d} onUpdate={handleDeliverableUpdate} />
              ))}
            </div>

            <form
              onSubmit={handleOutsideScopeSubmit}
              className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-3"
            >
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase">
                Outside-Scope Request
              </h4>
              <input
                type="text"
                required
                placeholder="Deliverable name"
                value={outsideScopeForm.name}
                onChange={(e) => setOutsideScopeForm({ ...outsideScopeForm, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={outsideScopeForm.description}
                onChange={(e) => setOutsideScopeForm({ ...outsideScopeForm, description: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <select
                value={outsideScopeForm.cadence}
                onChange={(e) => setOutsideScopeForm({ ...outsideScopeForm, cadence: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                <option value="ONE_TIME">One-time</option>
                <option value="RECURRING">Recurring</option>
              </select>
              <button
                type="submit"
                className="px-4 py-2 bg-fuchsia-600 rounded-xl font-bold text-xs text-white hover:bg-fuchsia-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                Log Outside-Scope Work
              </button>
            </form>
          </div>
        )}

        {tab === 'memory' && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2 flex items-center gap-1">
                <FileText className="w-3 h-3" /> Relationship Brief
              </h4>
              {detail.brief ? (
                <p className="text-xs text-slate-300">{detail.brief.briefText}</p>
              ) : (
                <p className="text-xs text-slate-600">No relationship brief generated yet.</p>
              )}
            </div>

            {onboarding?.overrides?.length > 0 && (
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
                <h4 className="text-[9px] font-mono font-bold tracking-wider text-amber-400 uppercase mb-2 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Launch-Gate Overrides
                </h4>
                {onboarding.overrides.map((o: any) => (
                  <p key={o.id} className="text-xs text-slate-400">
                    {new Date(o.createdAt).toLocaleDateString()}: {o.reason}
                  </p>
                ))}
              </div>
            )}

            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
              <h4 className="text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase mb-2 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Completed Milestones
              </h4>
              {onboarding?.items?.filter((i: any) => i.completedAt).length > 0 ? (
                onboarding.items
                  .filter((i: any) => i.completedAt)
                  .map((i: any) => (
                    <p key={i.id} className="text-xs text-slate-400">
                      {new Date(i.completedAt).toLocaleDateString()}: {i.title} completed
                    </p>
                  ))
              ) : (
                <p className="text-xs text-slate-600">No completed items yet.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
