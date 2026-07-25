'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../../components/Sidebar';
import { api, getAuthToken, getActiveUser } from '../../../lib/api';
import {
  MessageSquare,
  AlertTriangle,
  X,
  RefreshCw,
  Phone,
  Mail,
} from 'lucide-react';

interface Conversation {
  id: string;
  channel: 'SMS' | 'EMAIL';
  counterpartyAddress: string;
  lastMessageAt: string;
  contact: { firstName: string; lastName: string } | null;
  channelConnection: { status: string; type: string };
}

export default function CommunicationsPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchConversations = async () => {
    try {
      const workspaceId = getActiveUser()?.workspaceId;
      if (!workspaceId) {
        router.push('/');
        return;
      }
      const data = await api.listConversations(workspaceId);
      setConversations(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load conversations');
    }
  };

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    (async () => {
      await fetchConversations();
      setLoading(false);
    })();
  }, [router]);

  const getStatusBanner = (status: string) => {
    switch (status) {
      case 'NOT_CONFIGURED':
        return {
          tone: 'bg-slate-900/80 border-slate-600/50 text-slate-300',
          icon: AlertTriangle,
          label: 'NOT CONFIGURED',
          description: 'Provider credentials not set up yet.',
        };
      case 'DEGRADED':
        return {
          tone: 'bg-amber-900/50 border-amber-500/30 text-amber-300',
          icon: AlertTriangle,
          label: 'DEGRADED',
          description: 'Provider connection exists but not fully operational.',
        };
      case 'DISCONNECTED':
        return {
          tone: 'bg-rose-900/50 border-rose-500/30 text-rose-300',
          icon: AlertTriangle,
          label: 'DISCONNECTED',
          description: 'Provider connection lost.',
        };
      default:
        return null;
    }
  };

  const formatLastMessageTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto flex flex-col">
        <header className="mb-8 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Communications</h2>
            <p className="text-sm text-slate-500 mt-1.5">
              {conversations.length} conversation{conversations.length === 1 ? '' : 's'}.
            </p>
          </div>

          <button
            onClick={() => {
              setRefreshing(true);
              fetchConversations().finally(() => setRefreshing(false));
            }}
            disabled={refreshing || loading}
            className="px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl font-semibold text-xs hover:bg-slate-800/50 transition flex items-center gap-2 text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
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

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-4" />
              <p className="text-slate-400">Loading conversations...</p>
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-24 border border-dashed border-slate-800 rounded-3xl">
            <MessageSquare className="w-12 h-12 text-slate-700 mb-4" />
            <p className="text-slate-400 font-medium">No conversations yet.</p>
            <p className="text-slate-600 text-sm mt-1">
              Conversations will appear here once messaging starts.
            </p>
            <p className="text-slate-600 text-xs mt-2">
              Provider connections must be configured first to enable sending messages.
            </p>
          </div>
        ) : (
          <>
            {/* Provider Status Banners */}
            {(() => {
              const statusCounts = conversations.reduce((acc, conv) => {
                acc[conv.channelConnection.status] = (acc[conv.channelConnection.status] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);

              return Object.entries(statusCounts).map(([status, count]) => {
                const banner = getStatusBanner(status);
                if (!banner) return null;
                const Icon = banner.icon;
                return (
                  <div
                    key={status}
                    className={`mb-6 px-4 py-3 rounded-xl border flex items-start gap-3 text-sm ${banner.tone}`}
                  >
                    <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold">{banner.label} ({count} conversations)</p>
                      <p className="text-xs mt-1 opacity-90">{banner.description}</p>
                    </div>
                  </div>
                );
              });
            })()}

            <div className="bg-slate-950/40 border border-slate-900 rounded-3xl overflow-hidden overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-900 text-[10px] uppercase font-mono tracking-wider text-slate-500 bg-slate-950/60">
                    <th className="px-5 py-4">Participant</th>
                    <th className="px-5 py-4">Channel</th>
                    <th className="px-5 py-4">Last Message</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Since</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/60">
                  {conversations.map((conv) => {
                    const statusBanner = getStatusBanner(conv.channelConnection.status);
                    const isActive = conv.channelConnection.status === 'ACTIVE';
                    return (
                      <tr
                        key={conv.id}
                        onClick={() => router.push(`/marketing/communications/${conv.id}`)}
                        className={`hover:bg-slate-900/40 cursor-pointer transition-colors duration-150 ${!isActive ? 'opacity-60' : ''}`}
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {conv.channel === 'SMS' ? (
                              <Phone className="w-4 h-4 text-slate-500" />
                            ) : (
                              <Mail className="w-4 h-4 text-slate-500" />
                            )}
                            <div>
                              <p className="text-sm font-semibold text-slate-200 whitespace-nowrap">
                                {conv.contact ? `${conv.contact.firstName} ${conv.contact.lastName}` : conv.counterpartyAddress}
                              </p>
                              <p className="text-xs text-slate-500 whitespace-nowrap">
                                {conv.channel === 'SMS' ? conv.counterpartyAddress : conv.counterpartyAddress}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border bg-slate-800/50 text-slate-300 border-slate-700">
                            {conv.channel === 'SMS' ? (
                              <Phone className="w-3 h-3" />
                            ) : (
                              <Mail className="w-3 h-3" />
                            )}
                            <span>{conv.channel}</span>
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-400 whitespace-nowrap">
                          {conv.lastMessageAt ? formatLastMessageTime(conv.lastMessageAt) : 'No messages'}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold border ${
                            conv.channelConnection.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            conv.channelConnection.status === 'DEGRADED' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            conv.channelConnection.status === 'DISCONNECTED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                            'bg-slate-500/10 text-slate-400 border-slate-500/20'
                          }`}>                            {conv.channelConnection.status === 'ACTIVE' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                            <span>{conv.channelConnection.status}</span>
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">
                          {conv.lastMessageAt ? formatLastMessageTime(conv.lastMessageAt) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
