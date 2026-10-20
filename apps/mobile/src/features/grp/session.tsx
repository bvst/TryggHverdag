/**
 * The phone's place in the group (GRP-01, approach items 4, 5 and 14):
 * whether it is signed in, as whom, and every call it makes with its
 * credential.
 *
 * Membership is the session. At start, with a credential in secure storage,
 * the app asks the server who it is (`GET /v1/me`):
 *   - a member: the member screen;
 *   - a 401: the credential is deleted, and the join screen says plainly that
 *     this phone is no longer signed in to the group (AC29). Any call that
 *     answers 401 does the same, wherever it is made;
 *   - no answer, or a 5xx: nothing is deleted, nothing signs out, and the app
 *     says the server could not be reached, with a retry. A database that
 *     blinked must never sign anyone out.
 * With no credential, a fresh install, the join screen, and nothing is asked
 * of the server.
 *
 * The join sends the code as typed, the join key and the name. A join
 * answered with no answer at all, or a 5xx, saved nothing and can be sent
 * again exactly as it was, the same join key with it, which the server takes
 * as the same join retried (AC5, AC27).
 */
import type { JoinResponse, Member } from '@trygghverdag/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { callApi, type ApiAnswer, type ApiRequest } from '../../shared/api/client';
import { secureStorage } from '../../shared/secure-storage';
import { makeJoinKey } from './join-key';

/** Where the phone stands. */
export type SessionState =
  | { phase: 'starting' }
  | { phase: 'joining'; signedOut: boolean }
  | { phase: 'unreachable' }
  | { phase: 'member'; member: Member };

/** A join as the phone sends it. */
export interface JoinBody {
  invitationCode: string;
  joinKey: string;
  displayName: string;
}

/** What a join came to: in, not a valid invitation, or nothing saved. */
export type JoinOutcome = 'joined' | 'notValid' | 'notSaved';

export interface GroupSession {
  state: SessionState;
  /** A join's body, with the join key this phone keeps, made once. */
  joinBody: (typed: { invitationCode: string; displayName: string }) => Promise<JoinBody>;
  /** Sends a join, the first time or again exactly as it was. */
  join: (body: JoinBody) => Promise<JoinOutcome>;
  /** Asks the server again who this phone is, after it could not be reached. */
  retry: () => Promise<void>;
  /** A call with this phone's credential. A 401 signs the phone out before it answers. */
  call: <T>(request: Omit<ApiRequest, 'credential'>) => Promise<ApiAnswer<T>>;
}

const SessionContext = createContext<GroupSession | null>(null);

/** The session, for the screens under the provider. */
export function useGroupSession(): GroupSession {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('useGroupSession is used outside GroupSessionProvider.');
  }
  return session;
}

/** Holds the session for every route under the root layout. */
export function GroupSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ phase: 'starting' });
  const credential = useRef<string | null>(null);
  const mounted = useRef(true);
  const update = useCallback((next: SessionState) => {
    if (mounted.current) {
      setState(next);
    }
  }, []);

  /** The credential is gone from the phone, and the join screen says so. */
  const signOut = useCallback(async () => {
    credential.current = null;
    try {
      await secureStorage.deleteCredential();
    } catch {
      // The server has refused the credential, so the phone is signed out
      // whether or not the delete worked, and the join screen says so. A
      // credential left behind is refused again at the next start, which
      // tries the delete again.
    }
    update({ phase: 'joining', signedOut: true });
  }, [update]);

  /** Who this phone is, by its credential. */
  const checkIn = useCallback(
    async (stored: string) => {
      const answer = await callApi<Member>({ method: 'GET', path: 'me', credential: stored });
      switch (answer.kind) {
        case 'ok':
          credential.current = stored;
          update({ phase: 'member', member: answer.body });
          return;
        case 'unauthorized':
          await signOut();
          return;
        case 'refused':
        case 'unreachable':
          // Only a 401 signs out; the credential is kept for the retry.
          update({ phase: 'unreachable' });
          return;
      }
    },
    [signOut, update],
  );

  const start = useCallback(async () => {
    let stored: string | null;
    try {
      stored = await secureStorage.readCredential();
    } catch {
      update({ phase: 'unreachable' });
      return;
    }
    if (stored === null) {
      update({ phase: 'joining', signedOut: false });
      return;
    }
    await checkIn(stored);
  }, [checkIn, update]);

  useEffect(() => {
    mounted.current = true;
    void start();
    return () => {
      mounted.current = false;
    };
  }, [start]);

  const joinBody = useCallback(
    async ({ invitationCode, displayName }: { invitationCode: string; displayName: string }) => {
      let joinKey = await secureStorage.readJoinKey();
      if (joinKey === null) {
        joinKey = await makeJoinKey();
        await secureStorage.saveJoinKey(joinKey);
      }
      return { invitationCode: invitationCode.trim(), joinKey, displayName: displayName.trim() };
    },
    [],
  );

  const join = useCallback(
    async (body: JoinBody): Promise<JoinOutcome> => {
      const answer = await callApi<JoinResponse>({ method: 'POST', path: 'group/members', body });
      if (answer.kind === 'unreachable') {
        return 'notSaved';
      }
      if (answer.kind !== 'ok') {
        return 'notValid';
      }
      const { credential: issued, userId, role } = answer.body;
      try {
        await secureStorage.saveCredential(issued);
      } catch {
        // Not kept, so not signed in: the same join, sent again, is answered
        // with a new credential (AC5).
        return 'notSaved';
      }
      credential.current = issued;
      update({ phase: 'member', member: { userId, displayName: body.displayName, role } });
      return 'joined';
    },
    [update],
  );

  const retry = useCallback(async () => {
    update({ phase: 'starting' });
    await start();
  }, [start, update]);

  const call = useCallback(
    async <T,>(request: Omit<ApiRequest, 'credential'>): Promise<ApiAnswer<T>> => {
      const current = credential.current;
      if (current === null) {
        return { kind: 'unauthorized' };
      }
      const answer = await callApi<T>({ ...request, credential: current });
      if (answer.kind === 'unauthorized') {
        await signOut();
      }
      return answer;
    },
    [signOut],
  );

  const session = useMemo<GroupSession>(
    () => ({ state, joinBody, join, retry, call }),
    [state, joinBody, join, retry, call],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
