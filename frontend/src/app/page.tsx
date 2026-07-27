'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight, Lock, Mail, User, Building, Globe } from 'lucide-react';
import { api, getAuthToken } from '../lib/api';
import { switchWorkspace, type WorkspaceChoice } from '../lib/session/client';
import WorkspacePicker from '../components/WorkspacePicker';

/** What the sign-in screen is showing right now. */
type Step = 'FORM' | 'CHOOSE_WORKSPACE' | 'NO_WORKSPACE';

export default function AuthPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // T9: sign-in no longer always ends at the dashboard. It can also end at a
  // workspace choice, or at an honest "no workspace" message.
  const [step, setStep] = useState<Step>('FORM');
  const [choices, setChoices] = useState<WorkspaceChoice[]>([]);
  const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(
    null,
  );

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [subdomain, setSubdomain] = useState('');

  useEffect(() => {
    // If already logged in, skip auth screen
    if (getAuthToken()) {
      router.push('/dashboard');
    }
  }, [router]);

  /** Opens the workspace the person picked. */
  const handleChooseWorkspace = async (workspaceId: string) => {
    setError('');
    setOpeningWorkspaceId(workspaceId);
    try {
      await switchWorkspace(workspaceId);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Could not open that workspace.');
      setOpeningWorkspaceId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const result = await api.login(email, password);

        // One workspace: already opened, nothing to ask.
        if (result.outcome === 'ENTERED') {
          router.push('/dashboard');
        } else if (result.outcome === 'SELECTION_REQUIRED') {
          // Several workspaces: the person chooses. Nothing is opened yet.
          setChoices(result.choices);
          setStep('CHOOSE_WORKSPACE');
        } else {
          // The password was right, but this account is not in any workspace.
          // Say so plainly instead of inventing one.
          setStep('NO_WORKSPACE');
        }
      } else {
        await api.register({
          email,
          passwordPlain: password,
          firstName,
          lastName,
          workspaceName,
          subdomain,
        });
        // Success: toggle back to login and prefill email
        setIsLogin(true);
        setError('Workspace created successfully! Please log in.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#060814] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Glow Elements */}
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md bg-slate-950/60 backdrop-blur-xl border border-slate-900 rounded-3xl p-8 shadow-2xl relative z-10">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-gradient-to-tr from-cyan-400 to-indigo-600 p-3 rounded-2xl mb-4 text-white shadow-lg">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <h2 className="text-2xl font-black bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
            DEMM CRM
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-mono tracking-wider">
            {step === 'CHOOSE_WORKSPACE'
              ? 'ONE MORE STEP'
              : step === 'NO_WORKSPACE'
                ? 'NOTHING TO OPEN YET'
                : isLogin
                  ? 'WELCOME BACK TO THE FUTURE'
                  : 'INITIALIZE YOUR ORG WORKSPACE'}
          </p>
        </div>

        {error && step !== 'CHOOSE_WORKSPACE' && (
          <div className={`p-4 mb-6 rounded-xl border text-sm ${
            error.includes('successfully')
              ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-400'
              : 'bg-rose-950/20 border-rose-500/30 text-rose-400'
          }`}>
            {error}
          </div>
        )}

        {/* Several workspaces -- the person picks. Nothing was opened for them. */}
        {step === 'CHOOSE_WORKSPACE' && (
          <WorkspacePicker
            choices={choices}
            onChoose={handleChooseWorkspace}
            busyWorkspaceId={openingWorkspaceId}
            error={error || null}
          />
        )}

        {/* No workspace at all. Said plainly, with the path that already exists. */}
        {step === 'NO_WORKSPACE' && (
          <div className="text-center">
            <p className="text-sm text-slate-300 leading-relaxed">
              You signed in, but this account is not part of any workspace yet.
            </p>
            <p className="text-sm text-slate-500 mt-3 leading-relaxed">
              Ask someone on your team to add you, or set up your own workspace
              below.
            </p>
            <button
              onClick={() => {
                setStep('FORM');
                setIsLogin(false);
                setError('');
              }}
              className="mt-6 w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl font-semibold text-sm hover:from-cyan-400 hover:to-indigo-500 transition-all duration-300 text-white"
            >
              Set up a workspace
            </button>
            <button
              onClick={() => {
                setStep('FORM');
                setError('');
              }}
              className="mt-3 text-sm text-cyan-400 hover:underline transition"
            >
              Use a different account
            </button>
          </div>
        )}

        {step === 'FORM' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  required
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
                />
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  required
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
                />
              </div>
            </div>
          )}

          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Mail className="w-4 h-4" />
            </span>
            <input
              type="email"
              required
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
            />
          </div>

          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Lock className="w-4 h-4" />
            </span>
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
            />
          </div>

          {!isLogin && (
            <>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Building className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  required
                  placeholder="Workspace Name"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
                />
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Globe className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  required
                  placeholder="Subdomain (e.g. photos, digital)"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl font-semibold text-sm hover:from-cyan-400 hover:to-indigo-500 transition-all duration-300 shadow-lg shadow-indigo-500/20 flex items-center justify-center space-x-2 text-white"
          >
            {loading ? (
              <span>Authenticating...</span>
            ) : (
              <>
                <span>{isLogin ? 'Sign In' : 'Spin Up Workspace'}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
        )}

        {step === 'FORM' && (
          <div className="mt-6 text-center text-sm">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-cyan-400 hover:underline transition"
            >
              {isLogin
                ? "Don't have a workspace? Spin up one here"
                : 'Already registered? Log in here'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
