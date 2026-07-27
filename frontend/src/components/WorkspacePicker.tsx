'use client';

import React from 'react';
import { Building2, ArrowRight, Loader2 } from 'lucide-react';
import type { WorkspaceChoice } from '../lib/session/client';

/**
 * The list of workspaces a person can open.
 *
 * Used in two places -- finishing sign-in, and switching later -- so both show
 * exactly the same options in exactly the same way.
 *
 * Wording rule: plain language only. No "tenant", "context", "session",
 * "token", or "authenticate". The person is choosing where to work, and the
 * screen should say that and nothing more.
 *
 * Workspace ids are never the visible label. They are internal identifiers and
 * mean nothing to the person reading the screen.
 */

/** Turns a stored role into words a person would actually say. */
function roleLabel(role?: string): string | null {
  switch (role) {
    case 'SUPERADMIN':
      return 'Full system access';
    case 'ORG_OWNER':
      return 'Owner';
    case 'ORG_ADMIN':
      return 'Company admin';
    case 'WORKSPACE_ADMIN':
      return 'Workspace admin';
    case 'AGENT':
      return 'Agent';
    case 'USER':
      return 'Team member';
    default:
      // An unknown role is left off rather than shown raw.
      return null;
  }
}

export interface WorkspacePickerProps {
  choices: WorkspaceChoice[];
  onChoose: (workspaceId: string) => void;
  /** Which row is currently being opened, if any. */
  busyWorkspaceId?: string | null;
  error?: string | null;
  disabled?: boolean;
}

export default function WorkspacePicker({
  choices,
  onChoose,
  busyWorkspaceId = null,
  error = null,
  disabled = false,
}: WorkspacePickerProps) {
  return (
    <div>
      <h3 className="text-lg font-bold text-slate-100">
        Choose the workspace you want to open.
      </h3>
      <p className="text-sm text-slate-400 mt-1 mb-5">
        You have access to more than one. Pick the one you want to work in.
      </p>

      {error && (
        <div
          role="alert"
          className="p-3 mb-4 rounded-xl border bg-rose-950/20 border-rose-500/30 text-rose-400 text-sm"
        >
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {choices.map((choice) => {
          const busy = busyWorkspaceId === choice.workspaceId;
          const role = roleLabel(choice.role);
          return (
            <li key={choice.workspaceId}>
              <button
                type="button"
                disabled={disabled || busyWorkspaceId !== null}
                onClick={() => onChoose(choice.workspaceId)}
                className="w-full text-left flex items-center space-x-3 px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-cyan-500/50 hover:bg-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <span className="w-9 h-9 shrink-0 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
                  <Building2 className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-slate-100 truncate">
                    {choice.workspaceName || 'Company level'}
                  </span>
                  <span className="block text-xs text-slate-500 truncate">
                    {choice.organizationName}
                    {choice.organizationName && role ? ' · ' : ''}
                    {role}
                  </span>
                </span>
                {busy ? (
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                ) : (
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition-colors shrink-0" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
