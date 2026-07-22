'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../../components/Sidebar';
import { api, getAuthToken } from '../../../lib/api';
import {
  Tag,
  Plus,
  DollarSign,
  RefreshCw,
  ArrowUpCircle,
  Archive,
  Pencil,
  X,
  AlertTriangle,
  Globe,
  Lock,
} from 'lucide-react';

interface Offer {
  id: string;
  key: string;
  version: number;
  name: string;
  price: string | number;
  setupFee: string | number | null;
  includedServices: string[];
  excludedServices: string[];
  onboardingRequirements: string[];
  supportBoundaries: string;
  reportingCadence: string;
  cancellationTerms: string;
  expectedLaunchTime: string;
  lifecycleState: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  isPubliclyAvailable: boolean;
}

const LIFECYCLE_STYLES: Record<Offer['lifecycleState'], string> = {
  DRAFT: 'bg-slate-800 text-slate-400 border-slate-700',
  ACTIVE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  RETIRED: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

const EMPTY_FORM = {
  key: '',
  name: '',
  price: '',
  setupFee: '',
  includedServices: '',
  excludedServices: '',
  onboardingRequirements: '',
  supportBoundaries: '',
  reportingCadence: '',
  cancellationTerms: '',
  expectedLaunchTime: '',
  isPubliclyAvailable: false,
};

function toLines(value: string[] | undefined): string {
  return (value || []).join('\n');
}

function fromLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function OffersPage() {
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchOffers = async () => {
    try {
      const list = await api.getOffers();
      setOffers(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load offers.');
    }
  };

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    (async () => {
      await fetchOffers();
      setLoading(false);
    })();
  }, [router]);

  const openCreateForm = () => {
    setForm(EMPTY_FORM);
    setEditingOfferId(null);
    setError(null);
    setShowForm(true);
  };

  const openEditForm = (offer: Offer) => {
    setForm({
      key: offer.key,
      name: offer.name,
      price: String(offer.price),
      setupFee: offer.setupFee !== null ? String(offer.setupFee) : '',
      includedServices: toLines(offer.includedServices),
      excludedServices: toLines(offer.excludedServices),
      onboardingRequirements: toLines(offer.onboardingRequirements),
      supportBoundaries: offer.supportBoundaries,
      reportingCadence: offer.reportingCadence,
      cancellationTerms: offer.cancellationTerms,
      expectedLaunchTime: offer.expectedLaunchTime,
      isPubliclyAvailable: offer.isPubliclyAvailable,
    });
    setEditingOfferId(offer.id);
    setError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingOfferId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const sharedPayload: any = {
      name: form.name,
      price: parseFloat(form.price),
      setupFee: form.setupFee.trim() === '' ? undefined : parseFloat(form.setupFee),
      includedServices: fromLines(form.includedServices),
      excludedServices: fromLines(form.excludedServices),
      onboardingRequirements: fromLines(form.onboardingRequirements),
      supportBoundaries: form.supportBoundaries,
      reportingCadence: form.reportingCadence,
      cancellationTerms: form.cancellationTerms,
      expectedLaunchTime: form.expectedLaunchTime,
      isPubliclyAvailable: form.isPubliclyAvailable,
    };

    try {
      if (editingOfferId) {
        await api.updateOffer(editingOfferId, sharedPayload);
      } else {
        await api.createOffer({ ...sharedPayload, key: form.key });
      }
      await fetchOffers();
      closeForm();
    } catch (err: any) {
      setError(err.message || 'Failed to save offer.');
    } finally {
      setSaving(false);
    }
  };

  const handleLifecycle = async (offer: Offer, state: 'ACTIVE' | 'RETIRED') => {
    setError(null);
    try {
      await api.setOfferLifecycle(offer.id, state);
      await fetchOffers();
    } catch (err: any) {
      setError(err.message || `Failed to transition offer to ${state}.`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070913] text-slate-200 flex items-center justify-center font-mono">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mr-3" />
        LOADING OFFERS...
      </div>
    );
  }

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto flex flex-col">
        <header className="mb-8 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Offers &amp; Settings</h2>
            <p className="text-sm text-slate-500 mt-1.5">
              Manage what Marketing sells and its DRAFT → ACTIVE → RETIRED lifecycle.
            </p>
          </div>

          <button
            onClick={openCreateForm}
            className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl font-semibold text-xs hover:from-cyan-400 hover:to-indigo-500 transition flex items-center space-x-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 focus-visible:outline-offset-2"
          >
            <Plus className="w-4 h-4" />
            <span>New Offer</span>
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
            className="p-6 bg-slate-950/70 border border-slate-900 rounded-2xl mb-8 space-y-4 max-w-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide uppercase text-slate-400">
                {editingOfferId ? 'Edit Offer' : 'New Offer'}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                aria-label="Close form"
                className="text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editingOfferId && (
              <p className="text-xs text-slate-500">
                A material change (price, fees, services, boundaries, terms) to an ACTIVE
                offer creates a new DRAFT version instead of overwriting what a client already
                agreed to. Presentation-only fields (name, public visibility) update in place.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                required
                disabled={!!editingOfferId}
                placeholder="Key (e.g. founder-tier)"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <input
                type="text"
                required
                placeholder="Name (e.g. Founder Tier)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <input
                type="number"
                required
                min={0}
                step="0.01"
                placeholder="Price ($)"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="Setup fee ($, optional)"
                value={form.setupFee}
                onChange={(e) => setForm({ ...form, setupFee: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Included services (one per line)
                </span>
                <textarea
                  required
                  rows={3}
                  value={form.includedServices}
                  onChange={(e) => setForm({ ...form, includedServices: e.target.value })}
                  className="mt-1 w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Excluded services (one per line)
                </span>
                <textarea
                  required
                  rows={3}
                  value={form.excludedServices}
                  onChange={(e) => setForm({ ...form, excludedServices: e.target.value })}
                  className="mt-1 w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                Onboarding requirements (one per line)
              </span>
              <textarea
                required
                rows={2}
                value={form.onboardingRequirements}
                onChange={(e) => setForm({ ...form, onboardingRequirements: e.target.value })}
                className="mt-1 w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                required
                placeholder="Support boundaries"
                value={form.supportBoundaries}
                onChange={(e) => setForm({ ...form, supportBoundaries: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <input
                type="text"
                required
                placeholder="Reporting cadence"
                value={form.reportingCadence}
                onChange={(e) => setForm({ ...form, reportingCadence: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                required
                placeholder="Cancellation terms"
                value={form.cancellationTerms}
                onChange={(e) => setForm({ ...form, cancellationTerms: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              <input
                type="text"
                required
                placeholder="Expected launch time"
                value={form.expectedLaunchTime}
                onChange={(e) => setForm({ ...form, expectedLaunchTime: e.target.value })}
                className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={form.isPubliclyAvailable}
                onChange={(e) => setForm({ ...form, isPubliclyAvailable: e.target.checked })}
                className="rounded border-slate-700 bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
              Publicly available (visible to customers, not just internal)
            </label>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 text-xs font-semibold text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 rounded-xl font-bold text-xs hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                {saving ? 'Saving...' : editingOfferId ? 'Save Changes' : 'Create Offer'}
              </button>
            </div>
          </form>
        )}

        {offers.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-24 border border-dashed border-slate-900 rounded-3xl">
            <Tag className="w-10 h-10 text-slate-700 mb-4" />
            <p className="text-slate-400 font-medium">No offers yet.</p>
            <p className="text-slate-600 text-sm mt-1">
              Create the first Offer to start converting leads into clients.
            </p>
          </div>
        ) : (
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className="p-5 bg-slate-950/40 border border-slate-900 rounded-2xl flex flex-col"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-slate-200 truncate">{offer.name}</h4>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {offer.key} · v{offer.version}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border flex-shrink-0 ${LIFECYCLE_STYLES[offer.lifecycleState]}`}
                  >
                    {offer.lifecycleState}
                  </span>
                </div>

                <div className="mt-3 flex items-center text-sm font-bold text-cyan-400 font-mono">
                  <DollarSign className="w-4 h-4 text-cyan-500 mr-0.5" />
                  <span>{Number(offer.price).toLocaleString()}</span>
                  {offer.setupFee !== null && Number(offer.setupFee) > 0 && (
                    <span className="ml-2 text-[10px] text-slate-500 font-normal">
                      + ${Number(offer.setupFee).toLocaleString()} setup
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">
                  {offer.isPubliclyAvailable ? (
                    <>
                      <Globe className="w-3 h-3" />
                      <span>Publicly available</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3 h-3" />
                      <span>Internal only</span>
                    </>
                  )}
                </div>

                {offer.includedServices.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[11px] text-slate-400 list-disc list-inside">
                    {offer.includedServices.slice(0, 3).map((s, i) => (
                      <li key={i} className="truncate">{s}</li>
                    ))}
                    {offer.includedServices.length > 3 && (
                      <li className="text-slate-600">
                        +{offer.includedServices.length - 3} more
                      </li>
                    )}
                  </ul>
                )}

                <div className="mt-4 pt-4 border-t border-slate-900 flex items-center justify-between gap-2">
                  <button
                    onClick={() => openEditForm(offer)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 rounded px-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>

                  {offer.lifecycleState === 'DRAFT' && (
                    <button
                      onClick={() => handleLifecycle(offer, 'ACTIVE')}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 rounded px-1"
                    >
                      <ArrowUpCircle className="w-3.5 h-3.5" />
                      Promote to Active
                    </button>
                  )}
                  {offer.lifecycleState === 'ACTIVE' && (
                    <button
                      onClick={() => handleLifecycle(offer, 'RETIRED')}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-400 hover:text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 rounded px-1"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Retire
                    </button>
                  )}
                  {offer.lifecycleState === 'RETIRED' && (
                    <span className="text-[10px] text-slate-600">No further transitions</span>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
