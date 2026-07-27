'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Lock, X, Loader2 } from 'lucide-react';
import {
  beginWorkspaceSwitch,
  switchWorkspace,
  cancelPendingWorkspaceSelection,
  type WorkspaceChoice,
} from '../lib/session/client';
import WorkspacePicker from './WorkspacePicker';

/**
 * Lets a signed-in person move to another workspace.
 *
 * WHY THIS ASKS FOR A PASSWORD -- and why that is not laziness:
 *
 * A workspace switch has to produce a real backend session for the new
 * workspace. Today the backend has exactly one way to mint one:
 * `select-workspace`, which requires the short-lived pre-auth token that only a
 * password login produces. A refresh token can only renew the workspace it was
 * issued for, and no authenticated endpoint lists the workspaces an account can
 * reach. So proving the password again is the only mechanism that currently
 * exists to obtain both a trustworthy workspace list and permission to enter
 * one.
 *
 * The rejected alternative was keeping the login's pre-auth token alive for the
 * whole session so switching would feel seamless. That would leave a reusable
 * workspace-entry credential sitting in memory for hours -- strictly worse than
 * one password prompt on a rare, deliberate action.
 *
 * The current session is never touched until a new workspace is actually
 * opened, so cancelling or getting the password wrong costs nothing.
 */
export default function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [choices, setChoices] = useState<WorkspaceChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState('');

  // The dialog is rendered into <body>, not in place. The sidebar sets
  // `backdrop-blur`, and a backdrop-filter makes an element the containing
  // block for `fixed` descendants -- so an in-place dialog was pinned inside
  // the 16rem sidebar column with its text truncated. Observed in a real
  // browser, not theorised. Mounted client-side only so server and client
  // markup agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const close = () => {
    cancelPendingWorkspaceSelection();
    setOpen(false);
    setPassword('');
    setChoices(null);
    setError('');
    setBusy(false);
    setOpeningWorkspaceId(null);
  };

  const handleConfirmPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const available = await beginWorkspaceSwitch(password);
      // The password is not needed again and is dropped immediately.
      setPassword('');
      if (available.length <= 1) {
        setError(
          'This account only has one workspace, so there is nothing to switch to.',
        );
        setChoices(null);
      } else {
        setChoices(available);
      }
    } catch (err: any) {
      setError(err.message || 'That password did not match. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleChoose = async (workspaceId: string) => {
    setError('');
    setOpeningWorkspaceId(workspaceId);
    try {
      await switchWorkspace(workspaceId);
      // A full page load, not a client-side route change: everything currently
      // on screen belongs to the previous workspace and must not survive.
      window.location.assign('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Could not open that workspace.');
      setOpeningWorkspaceId(null);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center space-x-3 px-4 py-3 text-slate-400 hover:bg-slate-900 hover:text-slate-200 rounded-xl transition-all duration-150"
      >
        <Building2 className="w-5 h-5" />
        <span className="font-medium text-sm">Switch workspace</span>
      </button>

      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl relative">
              <button
                onClick={close}
                aria-label="Close"
                className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition"
              >
                <X className="w-4 h-4" />
              </button>

              {choices ? (
                <WorkspacePicker
                  choices={choices}
                  onChoose={handleChoose}
                  busyWorkspaceId={openingWorkspaceId}
                  error={error || null}
                />
              ) : (
                <form onSubmit={handleConfirmPassword}>
                  <h3 className="text-lg font-bold text-slate-100">
                    Switch to another workspace
                  </h3>
                  <p className="text-sm text-slate-400 mt-1 mb-5 leading-relaxed">
                    Enter your password to see the other workspaces you can
                    open. This keeps your account safe.
                  </p>

                  {error && (
                    <div
                      role="alert"
                      className="p-3 mb-4 rounded-xl border bg-rose-950/20 border-rose-500/30 text-rose-400 text-sm"
                    >
                      {error}
                    </div>
                  )}

                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                      <Lock className="w-4 h-4" />
                    </span>
                    <input
                      type="password"
                      required
                      autoFocus
                      autoComplete="current-password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl focus:border-cyan-500/50 focus:outline-none text-sm text-slate-100 transition-all"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="mt-4 w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl font-semibold text-sm hover:from-cyan-400 hover:to-indigo-500 transition-all duration-300 text-white flex items-center justify-center space-x-2 disabled:opacity-60"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Checking...</span>
                      </>
                    ) : (
                      <span>Continue</span>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
