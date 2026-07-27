'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import { api, getAuthToken, ApiError } from '../../lib/api';
import {
  describeAgentResponse,
  classifyToolList,
  summarizeArgumentFields,
  STEP_PREVIEW_COPY,
  type AgentOutcome,
  type ToolListState,
} from '../../components/agent/agentStatus';
import {
  Terminal,
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Lock,
  CloudOff,
  Plus,
  Trash2,
  RefreshCw,
} from 'lucide-react';

/**
 * T11 removed the pretence that this page was an AI assistant.
 *
 * What was here before:
 *  - A chat window greeting the user as "your DEMM CRM Agent Employee".
 *  - A chain of `lower.includes('contact')` keyword checks presented as the
 *    agent "determining" what to do from free text.
 *  - Invented arguments for those calls. Typing "add contact" really did POST a
 *    contact named Sarah Connor, sarah@sky.net, 555-0199 into the user's live
 *    CRM. Unrecognised input silently ran `getDashboard` instead.
 *  - "Agent processing workflow outcomes..." with a spinning icon, and a
 *    success line that was assigned before the response status was read.
 *  - `JSON.stringify(args)` echoed into the transcript.
 *  - A local array labelled "Audit Trail History".
 *
 * What this page is now: a plain, honest way to run one of the tools the
 * backend actually registers, with arguments the person types themselves, and
 * a truthful report of what the server said. Nothing is inferred, nothing is
 * defaulted, and nothing claims to have run until the server says it ran.
 */

interface ArgField {
  key: string;
  value: string;
}

interface RunRecord {
  toolName: string;
  fields: string[];
  outcome: AgentOutcome;
  at: string;
}

/**
 * Sends a number when the person typed a number, and text otherwise. This is a
 * visible, documented rule shown next to the inputs -- not a guess about what
 * they meant.
 */
function coerce(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}

export default function AgentConsole() {
  const router = useRouter();

  const [toolState, setToolState] = useState<ToolListState>({ kind: 'LOADING' });
  const [selectedTool, setSelectedTool] = useState('');
  const [fields, setFields] = useState<ArgField[]>([{ key: '', value: '' }]);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<AgentOutcome | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [history, setHistory] = useState<RunRecord[]>([]);

  useEffect(() => {
    if (!getAuthToken()) {
      router.push('/');
      return;
    }

    let cancelled = false;
    const loadTools = async () => {
      try {
        const list = await api.getTools();
        if (cancelled) return;
        setToolState(
          classifyToolList({ loading: false, error: null, tools: list }),
        );
      } catch (err) {
        // No sample tools on failure. An empty or broken registry is reported
        // as such, because offering a tool that does not exist is a lie the
        // user only discovers after clicking it.
        if (cancelled) return;
        setToolState(
          classifyToolList({
            loading: false,
            error: {
              status: err instanceof ApiError ? err.status : undefined,
              message: err instanceof Error ? err.message : undefined,
            },
            tools: null,
          }),
        );
      }
    };

    loadTools();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const buildArguments = (): Record<string, unknown> => {
    const args: Record<string, unknown> = {};
    for (const field of fields) {
      const key = field.key.trim();
      if (key === '') continue;
      args[key] = coerce(field.value);
    }
    return args;
  };

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTool || running) return;

    setRunning(true);
    setOutcome(null);
    setRequestError(null);

    const args = buildArguments();

    try {
      const response = await api.executeTool(selectedTool, args);
      // The response decides what is displayed. There is no default success.
      const described = describeAgentResponse(response);
      setOutcome(described);
      setHistory((prev) => [
        {
          toolName: selectedTool,
          fields: summarizeArgumentFields(args),
          outcome: described,
          at: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
    } catch (err) {
      // A rejected request is a rejected request. It is never converted into a
      // default response or a quiet success.
      const status = err instanceof ApiError ? err.status : undefined;
      setRequestError(
        status === 403
          ? 'You do not have permission to run this action. Ask an administrator.'
          : err instanceof Error
            ? err.message
            : 'The request did not go through.',
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex bg-[#070913] min-h-screen text-slate-100 font-sans">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto max-w-7xl mx-auto w-full flex flex-col lg:flex-row gap-8">
        <div className="flex-1 space-y-6">
          <header>
            <h2 className="text-3xl font-extrabold tracking-tight flex items-center space-x-3">
              <Terminal className="w-7 h-7 text-cyan-400" />
              <span>Run an action</span>
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Pick one of the actions your workspace supports, fill in the
              details, and run it. Everything here is sent to the server exactly
              as you type it.
            </p>
          </header>

          {/* Honest statement about the missing preview capability. */}
          <section className="p-4 rounded-2xl border border-slate-800 bg-slate-950/40">
            <p className="text-sm font-semibold text-slate-300">
              {STEP_PREVIEW_COPY.heading}
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {STEP_PREVIEW_COPY.detail}
            </p>
          </section>

          <form
            onSubmit={handleRun}
            className="p-6 bg-slate-950/40 border border-slate-900 rounded-3xl space-y-5"
          >
            <div>
              <label
                htmlFor="tool"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono mb-2"
              >
                Action
              </label>

              {toolState.kind === 'LOADING' && (
                <p className="text-sm text-slate-500 flex items-center">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2 text-cyan-400" />
                  Loading the actions you can run...
                </p>
              )}

              {toolState.kind === 'READY' && (
                <select
                  id="tool"
                  value={selectedTool}
                  onChange={(e) => setSelectedTool(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="">Choose an action...</option>
                  {toolState.tools.map((tool) => (
                    <option key={tool.name} value={tool.name}>
                      {tool.name}
                    </option>
                  ))}
                </select>
              )}

              {toolState.kind === 'EMPTY' && (
                <p className="text-sm text-slate-400 leading-relaxed">
                  There are no actions available in this workspace. Nothing is
                  hidden &mdash; the server did not offer any.
                </p>
              )}

              {toolState.kind === 'FORBIDDEN' && (
                <p className="text-sm text-amber-400 flex items-start">
                  <Lock className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                  Your account is not allowed to see the list of actions.
                </p>
              )}

              {toolState.kind === 'UNAVAILABLE' && (
                <p className="text-sm text-rose-400 flex items-start">
                  <CloudOff className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                  We could not load the list of actions, so none are shown.
                  {toolState.detail ? ` (${toolState.detail})` : ''}
                </p>
              )}

              {toolState.kind === 'READY' && selectedTool && (
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  {
                    toolState.tools.find((t) => t.name === selectedTool)
                      ?.description
                  }
                </p>
              )}
            </div>

            {toolState.kind === 'READY' && (
              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono mb-2">
                  Details you provide
                </span>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  This version cannot tell you which details each action needs,
                  because the server does not publish that list yet. Type the
                  name of a detail and its value. Whole numbers and decimals are
                  sent as numbers.
                </p>

                <div className="space-y-2">
                  {fields.map((field, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <input
                        aria-label={`Detail name ${index + 1}`}
                        placeholder="Name (for example: firstName)"
                        value={field.key}
                        onChange={(e) => {
                          const next = [...fields];
                          next[index] = { ...next[index], key: e.target.value };
                          setFields(next);
                        }}
                        className="flex-1 min-w-0 px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-cyan-500/50"
                      />
                      <input
                        aria-label={`Detail value ${index + 1}`}
                        placeholder="Value"
                        value={field.value}
                        onChange={(e) => {
                          const next = [...fields];
                          next[index] = {
                            ...next[index],
                            value: e.target.value,
                          };
                          setFields(next);
                        }}
                        className="flex-1 min-w-0 px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-cyan-500/50"
                      />
                      <button
                        type="button"
                        aria-label="Remove this detail"
                        onClick={() =>
                          setFields(
                            fields.length === 1
                              ? [{ key: '', value: '' }]
                              : fields.filter((_, i) => i !== index),
                          )
                        }
                        className="p-2.5 text-slate-600 hover:text-rose-400 transition shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setFields([...fields, { key: '', value: '' }])}
                  className="mt-3 text-xs text-cyan-400 hover:underline flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add another detail</span>
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={!selectedTool || running || toolState.kind !== 'READY'}
              className="w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl font-semibold text-sm text-white hover:from-cyan-400 hover:to-indigo-500 transition-all flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" />
              <span>{running ? 'Sending...' : 'Run the action'}</span>
            </button>
            {running && (
              <p className="text-xs text-slate-500 text-center">
                Waiting for the server to answer.
              </p>
            )}
          </form>

          {requestError && (
            <section className="p-5 rounded-2xl border border-rose-500/20 bg-rose-950/10">
              <h3 className="text-sm font-bold text-rose-400 flex items-center">
                <XCircle className="w-4 h-4 mr-2" />
                The request did not go through.
              </h3>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed break-words">
                {requestError}
              </p>
            </section>
          )}

          {outcome && <OutcomePanel outcome={outcome} />}
        </div>

        {/* Right column: real tool list + what this tab has run. */}
        <div className="w-full lg:w-80 space-y-6">
          <section className="p-6 bg-slate-950/40 border border-slate-900 rounded-3xl">
            <h4 className="font-bold text-sm text-slate-200 mb-1">
              Actions this workspace supports
            </h4>
            <p className="text-[11px] text-slate-500 mb-4">
              This list comes from the server.
            </p>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {toolState.kind === 'READY' ? (
                toolState.tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="p-2.5 bg-slate-900/40 border border-slate-800 rounded-xl"
                  >
                    <span className="text-[11px] font-mono font-bold text-cyan-400 break-words">
                      {tool.name}
                    </span>
                    <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                      {tool.description}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-slate-600">
                  {toolState.kind === 'LOADING'
                    ? 'Loading...'
                    : toolState.kind === 'EMPTY'
                      ? 'The server offered no actions.'
                      : 'The list could not be loaded.'}
                </p>
              )}
            </div>
          </section>

          <section className="p-6 bg-slate-950/40 border border-slate-900 rounded-3xl">
            <h4 className="font-bold text-sm text-slate-200 mb-1">
              What you ran in this tab
            </h4>
            <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
              This is only what happened on this screen. It is cleared when you
              reload, and it is not the server&apos;s permanent record.
            </p>
            <div className="space-y-3 max-h-72 overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-[11px] text-slate-600">
                  You have not run anything yet.
                </p>
              ) : (
                history.map((record, i) => (
                  <div
                    key={i}
                    className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-[10px] space-y-1"
                  >
                    <div className="flex justify-between items-center font-bold font-mono">
                      <span className="text-slate-300 break-words">
                        {record.toolName}
                      </span>
                      <span className="text-slate-500 shrink-0 ml-2">
                        {record.at}
                      </span>
                    </div>
                    <p className={statusTone(record.outcome.kind)}>
                      {statusLabel(record.outcome.kind)}
                    </p>
                    {record.fields.length > 0 && (
                      // Field NAMES only. Values are never printed here.
                      <p className="text-slate-600 font-mono break-words">
                        Details sent: {record.fields.join(', ')}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function statusLabel(kind: AgentOutcome['kind']): string {
  switch (kind) {
    case 'SUCCESS':
      return 'Ran successfully';
    case 'APPROVAL_REQUIRED':
      return 'Waiting for approval';
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'REJECTED':
      return 'Turned down';
    case 'EXPIRED':
      return 'Expired';
    default:
      return 'Unclear result';
  }
}

function statusTone(kind: AgentOutcome['kind']): string {
  switch (kind) {
    case 'SUCCESS':
      return 'text-emerald-400 font-bold';
    case 'APPROVAL_REQUIRED':
      return 'text-amber-400 font-bold';
    case 'FAILED':
    case 'REJECTED':
      return 'text-rose-400 font-bold';
    default:
      return 'text-slate-400 font-bold';
  }
}

function OutcomePanel({ outcome }: { outcome: AgentOutcome }) {
  const border =
    outcome.kind === 'SUCCESS'
      ? 'border-emerald-500/20 bg-emerald-950/10'
      : outcome.kind === 'APPROVAL_REQUIRED'
        ? 'border-amber-500/20 bg-amber-950/10'
        : outcome.kind === 'FAILED' || outcome.kind === 'REJECTED'
          ? 'border-rose-500/20 bg-rose-950/10'
          : 'border-slate-800 bg-slate-950/40';

  const Icon =
    outcome.kind === 'SUCCESS'
      ? CheckCircle
      : outcome.kind === 'APPROVAL_REQUIRED'
        ? AlertTriangle
        : outcome.kind === 'FAILED' || outcome.kind === 'REJECTED'
          ? XCircle
          : HelpCircle;

  return (
    <section className={`p-5 rounded-2xl border ${border}`}>
      <h3 className="text-sm font-bold text-slate-100 flex items-start">
        <Icon className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
        <span>{outcome.headline}</span>
      </h3>

      {outcome.kind !== 'SUCCESS' && (
        <p className="text-xs text-slate-400 mt-2 leading-relaxed break-words">
          {outcome.detail}
        </p>
      )}

      {outcome.kind === 'APPROVAL_REQUIRED' && (
        <div className="mt-3 text-[11px] text-slate-500 font-mono space-y-0.5">
          {outcome.approvalId && <p>Request number: {outcome.approvalId}</p>}
          {outcome.expiresAt && (
            <p>
              Needs an answer before:{' '}
              {new Date(outcome.expiresAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {outcome.kind === 'SUCCESS' && outcome.result !== null && (
        <p className="text-xs text-slate-400 mt-2">
          The server saved your change.
        </p>
      )}
    </section>
  );
}
