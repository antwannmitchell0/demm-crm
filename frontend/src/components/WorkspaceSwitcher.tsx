'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, X, Loader2 } from 'lucide-react';
import {
  beginWorkspaceSwitch,
  switchWorkspace,
  cancelPendingWorkspaceSelection,
  type WorkspaceChoice,
} from '../lib/session/client';
import WorkspacePicker from './WorkspacePicker';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Lets a signed-in person move to another workspace.
 *
 * THIS USED TO ASK FOR A PASSWORD. Not as a security decision -- it was the
 * only mechanism that existed. The backend could mint a workspace-bound session
 * exactly one way (`select-workspace`, needing the pre-auth token only a
 * password produces), and nothing listed an account's workspaces to an
 * authenticated caller, so a full re-login was the only route to both the list
 * and the authority to enter one.
 *
 * Both halves now exist, so the prompt is gone. Opening this dialog reads the
 * account's memberships with the access token it already holds, and choosing
 * one spends the httpOnly refresh cookie server-side. The user's password never
 * goes back on the wire for something they are already authenticated to do.
 *
 * The current session is never touched until a new workspace is actually
 * opened, so cancelling or failing costs nothing.
 */
export default function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<WorkspaceChoice[] | null>(null);
  const [loading, setLoading] = useState(false);
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
    setChoices(null);
    setError('');
    setLoading(false);
    setOpeningWorkspaceId(null);
  };

  // Loading happens on the click, not in an effect keyed on `open`: the list is
  // a consequence of the user asking for it, and an effect would also re-run on
  // unrelated re-renders while the dialog sits open.
  const openSwitcher = async () => {
    setOpen(true);
    setError('');
    setChoices(null);
    setLoading(true);
    try {
      const available = await beginWorkspaceSwitch(API_URL);
      if (available.length <= 1) {
        setError(
          'This account only has one workspace, so there is nothing to switch to.',
        );
        setChoices(null);
      } else {
        setChoices(available);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not load your workspaces.');
    } finally {
      setLoading(false);
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
        onClick={openSwitcher}
        className="w-full flex items-center space-x-3 px-4 py-3 text-slate-400 hover:bg-slate-900 hover:text-slate-200 rounded-xl transition-all duration-150"
      >
        <Building2 className="w-5 h-5" />
        <span className="font-medium text-sm">Switch workspace</span>
      </button>

      {open && mounted
        ? createPortal(
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
                  <div>
                    <h3 className="text-lg font-bold text-slate-100">
                      Switch to another workspace
                    </h3>

                    {loading ? (
                      <div className="flex items-center space-x-3 mt-5 text-slate-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Loading your workspaces...</span>
                      </div>
                    ) : (
                      <div
                        role="alert"
                        className="p-3 mt-5 rounded-xl border bg-rose-950/20 border-rose-500/30 text-rose-400 text-sm"
                      >
                        {error || 'Could not load your workspaces.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
