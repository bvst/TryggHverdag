/**
 * The phone's place in the group (GRP-01, approach items 4, 5 and 14):
 * whether it is signed in, as whom, and every call it makes with its
 * credential; and the walker's #1 contact, which belongs to that place
 * (GRP-02, approach item 4).
 *
 * Membership is the session. At start, secure storage is read, and only
 * while it is, a waiting indicator shows (CALL-02, approach 2):
 *   - no credential, a fresh install: #1 is deleted, best effort, then the
 *     join screen, and nothing is asked of the server;
 *   - a credential: the home screen at once, with #1, the call button and
 *     112, and the server asked who this phone is (`GET /v1/me`) behind it,
 *     so a phone that cannot reach the server can still call (CALL-02-AC8,
 *     GRP-02-AC7). Nothing of the group shows until the server has said:
 *       - a member: the heading, the status line and, for the admin, the two
 *         choices;
 *       - a 401: the credential and #1 are deleted, and the join screen says
 *         plainly that this phone is no longer signed in to the group (AC29).
 *         Any call that answers 401 does the same, wherever it is made;
 *       - no answer, a 5xx, or any 4xx but a 401 (a 403, 404 or 409): nothing
 *         is deleted, nothing signs out, and the home screen says the server
 *         could not be reached, with a retry. A database that blinked must
 *         never sign anyone out;
 *   - storage that cannot be read: the home screen, as for no answer, and #1
 *     as unreadable when its own read fails (GRP-02-AC8).
 *
 * #1 is kept in secure storage and nowhere else, never sent to the server
 * (Q1, D-141), deleted with the credential when the phone is signed out, and
 * kept through an unreachable server (GRP-02-AC6). The delete at a sign-out
 * is one call the store can refuse, so a join that gets a new credential
 * deletes #1 again, best effort: a #1 still there then belongs to a home
 * screen that is gone, and a refusal does not fail the join. So does every
 * start with no credential, for a phone that never joins again; a start whose
 * credential read fails is not one, and keeps #1.
 *
 * The join sends the code as typed, the join key and the name. A join
 * answered with no answer at all, or a 5xx, saved nothing and can be sent
 * again exactly as it was, the same join key with it, which the server takes
 * as the same join retried (AC5, AC27). A new member has no #1.
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
import { storedFirstContact, type FirstContact, type FirstContactState } from './first-contact';
import { makeJoinKey } from './join-key';

/** What the server has said of this phone, on the home screen. */
export type ServerAnswer =
  { kind: 'asking' } | { kind: 'unreachable' } | { kind: 'member'; member: Member };

/** Where the phone stands. */
export type SessionState =
  | { phase: 'starting' }
  | { phase: 'joining'; signedOut: boolean }
  | { phase: 'home'; server: ServerAnswer; firstContact: FirstContactState };

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
  /** Keeps #1 in secure storage, as given; false when storage refused it, and nothing changed. */
  saveFirstContact: (contact: FirstContact) => Promise<boolean>;
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
  /** Changes the home screen's state, and leaves any other phase as it is. */
  const updateHome = useCallback((change: Partial<Extract<SessionState, { phase: 'home' }>>) => {
    if (mounted.current) {
      setState((now) => (now.phase === 'home' ? { ...now, ...change } : now));
    }
  }, []);

  /** The credential and #1 are gone from the phone, and the join screen says so. */
  const signOut = useCallback(async () => {
    credential.current = null;
    // The server has refused the credential, so the phone is signed out
    // whether or not each delete worked, and the join screen says so. A
    // credential left behind is refused again at the next start, which tries
    // the delete again.
    try {
      await secureStorage.deleteCredential();
    } catch {
      // Said by the join screen, as above.
    }
    try {
      await secureStorage.deleteFirstContact();
    } catch {
      // As for the credential: the home screen #1 belonged to is gone.
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
          updateHome({ server: { kind: 'member', member: answer.body } });
          return;
        case 'unauthorized':
          await signOut();
          return;
        case 'refused':
        case 'unreachable':
          // Only a 401 signs out; the credential and #1 are kept for the retry.
          updateHome({ server: { kind: 'unreachable' } });
          return;
      }
    },
    [signOut, updateHome],
  );

  /** #1 as secure storage holds it, or unreadable when the read fails (GRP-02-AC8). */
  const readFirstContact = useCallback(async (): Promise<FirstContactState> => {
    try {
      return storedFirstContact(await secureStorage.readFirstContact());
    } catch {
      return { kind: 'unreadable' };
    }
  }, []);

  const start = useCallback(async () => {
    let stored: string | null;
    try {
      stored = await secureStorage.readCredential();
    } catch {
      update({
        phase: 'home',
        server: { kind: 'unreachable' },
        firstContact: await readFirstContact(),
      });
      return;
    }
    if (stored === null) {
      // No credential, so no home screen, and no #1 should be here: one that
      // is was left by a refused delete at a sign-out, or by a save that
      // landed after it. Best effort, and before the join screen shows
      // (GRP-02-AC6).
      try {
        await secureStorage.deleteFirstContact();
      } catch {
        // Kept, and tried again at the next start with no credential. Not
        // logged: the error's message may hold the number (PRIV-07).
      }
      update({ phase: 'joining', signedOut: false });
      return;
    }
    update({ phase: 'home', server: { kind: 'asking' }, firstContact: await readFirstContact() });
    await checkIn(stored);
  }, [checkIn, readFirstContact, update]);

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
      // A #1 kept now was left by a refused delete at a sign-out: the join
      // screen shows only with no credential, and a new member has no #1. It
      // goes before the new credential is kept, so no stop between the two
      // can leave it on the new home screen. Best effort: a refusal here
      // does not fail the join (GRP-02-AC6).
      try {
        await secureStorage.deleteFirstContact();
      } catch {
        // Kept: the next start reads it and shows it on the home screen, in
        // front of the walker, who can change it (GRP-02, Risks).
      }
      try {
        await secureStorage.saveCredential(issued);
      } catch {
        // Not kept, so not signed in: the same join, sent again, is answered
        // with a new credential (AC5).
        return 'notSaved';
      }
      credential.current = issued;
      update({
        phase: 'home',
        server: { kind: 'member', member: { userId, displayName: body.displayName, role } },
        firstContact: { kind: 'none' },
      });
      return 'joined';
    },
    [update],
  );

  /** Asks the server again who this phone is, the home screen and #1 staying where they are. */
  const retry = useCallback(async () => {
    updateHome({ server: { kind: 'asking' } });
    await start();
  }, [start, updateHome]);

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

  const saveFirstContact = useCallback(
    async (contact: FirstContact): Promise<boolean> => {
      try {
        await secureStorage.saveFirstContact(contact);
      } catch {
        // Nothing was saved, and the earlier #1, or none, stays (GRP-02-AC8).
        // The error is not kept: its message may hold the number (PRIV-07).
        return false;
      }
      updateHome({ firstContact: { kind: 'set', contact } });
      return true;
    },
    [updateHome],
  );

  const session = useMemo<GroupSession>(
    () => ({ state, joinBody, join, retry, call, saveFirstContact }),
    [state, joinBody, join, retry, call, saveFirstContact],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
