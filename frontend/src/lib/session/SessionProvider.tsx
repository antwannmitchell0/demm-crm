'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  bootstrapSession,
  getSessionSnapshot,
  subscribeToSession,
  teardownSession,
  type SessionSnapshot,
} from './client';

const SessionContext = createContext<SessionSnapshot>({
  state: 'UNINITIALIZED',
  user: null,
});

export function useSession(): SessionSnapshot {
  return useContext(SessionContext);
}

/**
 * Restores the session before the app renders.
 *
 * Children are deliberately NOT mounted while state is UNINITIALIZED or
 * RESTORING. Existing pages gate themselves with a synchronous
 * `if (!getAuthToken()) router.push('/')` in a mount effect; because the access
 * token is now memory-only, mounting them before restoration completes would
 * bounce every reload to the login screen. Holding them back for the single
 * refresh round-trip preserves those pages unchanged while still removing the
 * token from browser storage.
 */
/**
 * Routes reachable WITHOUT a session.
 *
 * `/invite` belongs here because the person it exists for provably has no
 * session: they were invited to their first workspace, hold no membership, and
 * therefore cannot be issued an access token. Bouncing them to sign-in sent
 * them in a circle -- signing in gave them nothing to sign in TO, and reopening
 * the link bounced them again. The page authenticates them itself.
 */
const PUBLIC_ROUTES = new Set(['/', '/invite']);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionSnapshot>(getSessionSnapshot);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsubscribe = subscribeToSession(setSession);
    void bootstrapSession();
    return () => {
      unsubscribe();
      teardownSession();
    };
  }, []);

  // When the session ends -- logout in ANOTHER tab, a failed refresh, or
  // backend replay detection -- return to the login screen. Existing pages only
  // check authentication when they mount, so without this a tab that was logged
  // out remotely would keep displaying a fully-rendered dashboard even though
  // its token is gone. Clearing the token is the security control; this closes
  // the misleading-UI gap that would otherwise remain until navigation.
  useEffect(() => {
    if (session.state === 'UNAUTHENTICATED' && !PUBLIC_ROUTES.has(pathname)) {
      router.replace('/');
    }
  }, [session.state, pathname, router]);

  const restoring =
    session.state === 'UNINITIALIZED' || session.state === 'RESTORING';

  if (restoring) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-[#060814] text-slate-500"
        // Stable hook for the browser verification to observe the gate.
        data-session-state={session.state}
      >
        <div className="flex items-center space-x-3 text-xs font-mono tracking-wider">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>RESTORING SESSION</span>
        </div>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <div data-session-state={session.state} className="contents">
        {children}
      </div>
    </SessionContext.Provider>
  );
}
