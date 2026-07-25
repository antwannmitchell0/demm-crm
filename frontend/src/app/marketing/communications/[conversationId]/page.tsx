'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Sidebar from '../../../../components/Sidebar';
import { api, getAuthToken, getActiveUser } from '../../../../lib/api';
import {
  ArrowLeft,
  Send,
  User,
  AlertTriangle,
  CheckCircle2,
  X,
  Phone,
  Mail,
  Clock,
  Paperclip,
  FileText,
  RefreshCw,
} from 'lucide-react';

interface Message {
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  body: string | null;
  status: string;
  createdAt: string;
  sentByUser: { firstName: string; lastName: string } | null;
  template: { name: string } | null;
  deliveryAttempts: {
    id: string;
    outcome: 'SUCCEEDED' | 'FAILED' | 'UNDELIVERED' | 'BOUNCED' | 'COMPLAINED';
    occurredAt: string;
    providerCode?: string;
  }[];
}

interface Conversation {
  id: string;
  clientAccountId: string | null;
  channel: 'SMS' | 'EMAIL';
  counterpartyAddress: string;
  channelConnection: { status: string; type: string };
  contact?: { firstName: string; lastName: string } | null;
}

interface SendMessageResponse {
  id: string;
  direction: string;
  body: string | null;
  status: string;
  createdAt: string;
  sentByUser: { firstName: string; lastName: string } | null;
  deliveryAttempts: any[];
}

export default function ConversationThreadPage() {
  const router = useRouter();
  const params = useParams();
  const conversationId = params.conversationId as string;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');

  const fetchThread = async () => {
    try {
      const activeUser = getActiveUser();
      if (!activeUser?.workspaceId) {
        router.push('/');
        return;
      }
      const data = await api.getConversationThread(conversationId, activeUser.workspaceId);
      setConversation(data as any);
      setMessages(data.messages || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load conversation');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    fetchThread();
  }, [router, conversationId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversation) return;

    setSendLoading(true);
    setError(null);

    try {
      const activeUser = getActiveUser();
      if (!activeUser?.workspaceId) {
        router.push('/');
        return;
      }

      let response;
      if (conversation.channel === 'SMS') {
        response = await api.sendSms(
          conversation.clientAccountId || conversation.id,
          { body: newMessage },
          activeUser.workspaceId,
          activeUser.workspaceId,
        );
      } else {
        response = await api.sendEmail(
          conversation.clientAccountId || conversation.id,
          {
            subject: `Re: Message`,
            html: `<p>${newMessage}</p>`,
          },
          activeUser.workspaceId,
          activeUser.workspaceId,
        );
      }

      setNewMessage('');
      await fetchThread();
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setSendLoading(false);
    }
  };

  const getChannelIcon = (channel: string) => {
    return channel === 'SMS' ? (
      <Phone className="w-4 h-4" />
    ) : (
      <Mail className="w-4 h-4" />
    );
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'SENT':
      case 'DELIVERED':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'FAILED':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'UNDELIVERED':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'QUEUED':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getDeliveryStatusBadgeClass = (outcome: string) => {
    switch (outcome) {
      case 'SUCCEEDED':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'FAILED':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'UNDELIVERED':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'BOUNCED':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'COMPLAINED':
        return 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isChannelActive = conversation?.channelConnection.status === 'ACTIVE';

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto flex flex-col">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <button
            onClick={() => router.push('/marketing/communications')}
            className="px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-xl font-semibold text-xs hover:bg-slate-800/50 transition flex items-center gap-2 text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Conversations</span>
          </button>

          {conversation && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center">
                {getChannelIcon(conversation.channel)}
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">
                  {conversation.contact ? `${conversation.contact.firstName} ${conversation.contact.lastName}` : conversation.counterpartyAddress}
                </h2>
                <p className="text-xs text-slate-500">
                  {conversation.channel} • {conversation.counterpartyAddress}
                </p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold border ${
                conversation.channelConnection.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                conversation.channelConnection.status === 'DEGRADED' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                conversation.channelConnection.status === 'DISCONNECTED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                'bg-slate-500/10 text-slate-400 border-slate-500/20'
              }`}>                {conversation.channelConnection.status}
              </span>
            </div>
          )}
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
              <p className="text-slate-400">Loading conversation...</p>
            </div>
          </div>
        ) : conversation ? (
          <div className="flex-1 flex flex-col bg-slate-950/40 border border-slate-900 rounded-3xl overflow-hidden">
            {/* Messages area */}
            <div className="flex-1 p-6 space-y-4 max-h-96 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-500">No messages yet</p>
                </div>
              ) : (
                messages.map((message) => {
                  const isOutbound = message.direction === 'OUTBOUND';
                  const isFailed = message.status === 'FAILED';
                  const hasDeliveryIssues = message.deliveryAttempts.some(
                    (attempt) => ['FAILED', 'UNDELIVERED', 'BOUNCED', 'COMPLAINED'].includes(attempt.outcome)
                  );

                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-4`}
                    >
                      <div
                        className={`max-w-xs lg:max-w-md ${isOutbound ? 'order-1' : 'order-2'} ${isOutbound ? 'text-right' : 'text-left'}`}
                      >
                        <div
                          className={`inline-block px-4 py-3 rounded-2xl ${isOutbound
                            ? (isFailed
                                ? 'bg-rose-900/50 border border-rose-500/30 text-rose-200'
                                : isOutbound && hasDeliveryIssues
                                ? 'bg-orange-900/30 border border-orange-500/20 text-orange-200'
                                : 'bg-indigo-900/50 border border-indigo-500/30 text-indigo-100')
                            : 'bg-slate-900/50 border border-slate-700 text-slate-200'}`}
                        >
                          {message.direction === 'INBOUND' && (
                            <div className="flex items-center gap-2 mb-1 text-xs text-slate-500">
                              <span>Inbound</span>
                            </div>
                          )}
                          {message.body && (
                            <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                          )}
                          <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                            <span>{formatTime(message.createdAt)}</span>
                            {message.sentByUser && (
                              <span className="font-medium">
                                {isOutbound ? 'You' : `${message.sentByUser.firstName} ${message.sentByUser.lastName}`}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Delivery status indicator for outbound messages */}
                        {isOutbound && (hasDeliveryIssues || message.status === 'SENT') && (
                          <div className="mt-2 flex items-center gap-2 text-xs">
                            {hasDeliveryIssues && (
                              <span className="flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-orange-400" />
                                <span className="text-orange-400">Delivery issue</span>
                              </span>
                            )}
                            {(message.status === 'DELIVERED' || message.deliveryAttempts.some(a => a.outcome === 'SUCCEEDED')) && (
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Delivered</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Message input */}
            <div className="p-4 border-t border-slate-900 bg-slate-950/60">
              {!isChannelActive && (
                <div className="mb-4 px-4 py-3 bg-amber-900/30 border border-amber-500/30 rounded-xl text-sm text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>This channel is not ACTIVE. Cannot send messages until provider credentials are configured.</span>
                </div>
              )}

              <form onSubmit={handleSendMessage} className="flex gap-3">
                <button
                  type="button"
                  className="px-3 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl font-semibold text-xs hover:bg-slate-700/50 transition text-slate-300 flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                >
                  <Paperclip className="w-4 h-4" />
                  Attach
                </button>

                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={isChannelActive ? "Type a message..." : "Channel not active"}
                  disabled={!isChannelActive || sendLoading}
                  className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:border-cyan-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
                />

                <button
                  type="submit"
                  disabled={!newMessage.trim() || !isChannelActive || sendLoading}
                  className="px-4 py-2.5 bg-indigo-600 rounded-xl font-bold text-xs hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                >
                  {sendLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-500">Conversation not found</p>
          </div>
        )}
      </main>
    </div>
  );
}
