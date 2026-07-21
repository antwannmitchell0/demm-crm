'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import { api, getAuthToken } from '../../lib/api';
import { 
  Terminal, 
  Send, 
  Sparkles, 
  CheckCircle, 
  XCircle, 
  ShieldCheck,
  AlertTriangle,
  History
} from 'lucide-react';

interface ChatMessage {
  sender: 'user' | 'agent';
  text: string;
  toolCall?: {
    name: string;
    args: any;
    status: 'SUCCESS' | 'ERROR' | 'PENDING_APPROVAL';
    result?: any;
    error?: string;
  };
}

export default function AgentConsole() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      sender: 'agent',
      text: "Hello, I am your DEMM CRM Agent Employee. I execute operations through secure APIs. What outcome do you want to achieve today?",
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [tools, setTools] = useState<any[]>([]);
  const [execHistory, setExecHistory] = useState<any[]>([]);

  const fetchTools = async () => {
    try {
      const list = await api.getTools();
      setTools(list);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }
    fetchTools();
  }, [router]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    const userPrompt = prompt;
    setPrompt('');
    setLoading(true);

    // Append user message
    setMessages(prev => [...prev, { sender: 'user', text: userPrompt }]);

    try {
      // 1. Determine tool call from prompt (Outcome-driven mapping)
      let toolName = '';
      let args: any = {};
      const lower = userPrompt.toLowerCase();

      if (lower.includes('dashboard') || lower.includes('brief') || lower.includes('show stats')) {
        toolName = 'getDashboard';
      } else if (lower.includes('contact') && (lower.includes('create') || lower.includes('add'))) {
        toolName = 'createContact';
        // Extract names
        const names = userPrompt.match(/(?:contact|add)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
        args = {
          firstName: names ? names[1] : 'Sarah',
          lastName: names ? names[2] : 'Connor',
          emails: ['sarah@sky.net'],
          phones: ['555-0199'],
        };
      } else if (lower.includes('search') || lower.includes('find')) {
        toolName = 'searchContacts';
        const q = userPrompt.replace(/(?:search|find)\s+/i, '').trim();
        args = { query: q || 'Sarah' };
      } else if (lower.includes('pipeline') && (lower.includes('create') || lower.includes('make'))) {
        toolName = 'createPipeline';
        args = { name: 'Atlanta Wedding Workflow' };
      } else if (lower.includes('deal') && (lower.includes('create') || lower.includes('add'))) {
        toolName = 'createOpportunity';
        // High value test for approval workflow
        const value = lower.includes('high') ? 12000 : 750;
        args = {
          name: 'Atlanta Photo Booth Booking',
          value,
          probability: 80,
          pipelineId: '', // Let backend default or match
          stageId: '',
        };
      } else {
        // Fallback simulated call or default dashboard
        toolName = 'getDashboard';
      }

      // 2. Call backend tool execution API
      const response = await api.executeTool(toolName, args);

      // 3. Format Agent output
      let agentText = `Executed tool '${toolName}' successfully.`;
      if (response.status === 'PENDING_APPROVAL') {
        agentText = `⚠️ Human Approval Required: The operation '${toolName}' is classified as high-risk. I have staged it to the approval gate for your review.`;
      } else if (response.status === 'SUCCESS') {
        if (toolName === 'getDashboard') {
          agentText = `Dashboard Brief:\n\n${response.result.brief}`;
        } else if (toolName === 'createContact') {
          agentText = `Successfully created contact for ${response.result.firstName} ${response.result.lastName}.`;
        } else if (toolName === 'searchContacts') {
          agentText = `Found ${response.result.length} contact(s) matching query.`;
        } else {
          agentText = `Successfully executed outcomes for workspace pipeline context.`;
        }
      } else {
        agentText = `Tool execution failed: ${response.error}`;
      }

      setMessages(prev => [...prev, {
        sender: 'agent',
        text: agentText,
        toolCall: {
          name: toolName,
          args,
          status: response.status,
          result: response.result,
          error: response.error
        }
      }]);

      // Add to local audit logs history panel
      setExecHistory(prev => [{
        toolName,
        args,
        status: response.status,
        timestamp: new Date().toLocaleTimeString(),
      }, ...prev]);

    } catch (err: any) {
      setMessages(prev => [...prev, {
        sender: 'agent',
        text: `Error executing outcome: ${err.message}`
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto flex flex-col md:flex-row gap-8">
        
        {/* Chat / Conversation console */}
        <div className="flex-1 flex flex-col h-[650px] bg-slate-950/40 border border-slate-900 rounded-3xl overflow-hidden p-6">
          <div className="flex items-center space-x-2 pb-4 border-b border-slate-900 mb-4">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <h3 className="font-extrabold text-sm tracking-wide text-slate-200">AGENT WORKPLACE TERMINAL</h3>
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-md p-4 rounded-2xl text-xs leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-none'
                    : 'bg-slate-900/60 border border-slate-850 text-slate-300 rounded-bl-none'
                }`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  
                  {/* Tool Call Audit Trail Block */}
                  {m.toolCall && (
                    <div className="mt-3 pt-3 border-t border-slate-900 space-y-1 bg-slate-950/60 p-2.5 rounded-lg border border-slate-850">
                      <div className="flex items-center justify-between text-[9px] uppercase font-mono text-slate-500 font-bold">
                        <span>Tool: {m.toolCall.name}</span>
                        {m.toolCall.status === 'SUCCESS' && <span className="text-emerald-400 flex items-center"><CheckCircle className="w-3 h-3 mr-0.5" /> Success</span>}
                        {m.toolCall.status === 'ERROR' && <span className="text-rose-400 flex items-center"><XCircle className="w-3 h-3 mr-0.5" /> Error</span>}
                        {m.toolCall.status === 'PENDING_APPROVAL' && <span className="text-amber-400 flex items-center"><AlertTriangle className="w-3 h-3 mr-0.5" /> Approval Staged</span>}
                      </div>
                      <p className="text-[9px] text-slate-500 font-mono overflow-x-auto">
                        Args: {JSON.stringify(m.toolCall.args)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="p-4 bg-slate-900/30 rounded-2xl rounded-bl-none text-xs text-slate-500 flex items-center">
                  <Sparkles className="w-4 h-4 animate-spin text-cyan-400 mr-2" />
                  Agent processing workflow outcomes...
                </div>
              </div>
            )}
          </div>

          {/* Form input */}
          <form onSubmit={handleSend} className="flex space-x-2">
            <input
              type="text"
              placeholder="Ask for outcomes (e.g. 'Show stats', 'Add contact John Doe', 'Create high deal' for approval test)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="flex-1 px-4 py-3 bg-slate-900 border border-slate-850 rounded-xl text-xs focus:outline-none focus:border-cyan-500/50"
            />
            <button
              type="submit"
              disabled={loading}
              className="p-3 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl hover:from-cyan-400 hover:to-indigo-500 text-white"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Right side: Tool Registry and Audit History */}
        <div className="w-full md:w-80 flex flex-col gap-6">
          {/* Tool registry */}
          <div className="p-6 bg-slate-950/40 border border-slate-900 rounded-3xl">
            <h4 className="font-extrabold text-sm tracking-wide text-slate-200 mb-4 flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Tool Registry</span>
            </h4>
            <div className="space-y-3 max-h-48 overflow-y-auto">
              {tools.map(t => (
                <div key={t.name} className="p-2.5 bg-slate-900/40 border border-slate-850 rounded-xl">
                  <span className="text-[10px] font-mono font-bold text-cyan-400">{t.name}</span>
                  <p className="text-[9px] text-slate-500 mt-0.5">{t.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Execution History Audit Logs */}
          <div className="p-6 bg-slate-950/40 border border-slate-900 rounded-3xl flex-1">
            <h4 className="font-extrabold text-sm tracking-wide text-slate-200 mb-4 flex items-center space-x-1.5">
              <History className="w-4 h-4 text-indigo-400" />
              <span>Audit Trail History</span>
            </h4>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {execHistory.length === 0 ? (
                <p className="text-[10px] text-slate-600">No execution logs recorded yet.</p>
              ) : (
                execHistory.map((h, i) => (
                  <div key={i} className="p-2.5 bg-slate-900/60 border border-slate-850 rounded-xl text-[9px] space-y-1">
                    <div className="flex justify-between items-center font-bold font-mono">
                      <span className="text-slate-300">{h.toolName}</span>
                      <span className="text-slate-500">{h.timestamp}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-mono">Status:</span>
                      <span className={
                        h.status === 'SUCCESS' ? 'text-emerald-400 font-bold' :
                        h.status === 'PENDING_APPROVAL' ? 'text-amber-400 font-bold' : 'text-rose-400 font-bold'
                      }>{h.status}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
