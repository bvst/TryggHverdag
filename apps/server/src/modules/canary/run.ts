/**
 * The staging canary's run (REL-10; D-127, D-128): a test walker goes silent,
 * and the alert must reach the push port in time. The worker runs it every
 * 15 minutes on Graphile Worker's cron, and the owner is paged when it fails.
 *
 * A run, in order, each step's failure named:
 *   1. registration of the canary's three fixed identities, once per process,
 *      and again on each run until it has succeeded;
 *   2. the start, through the public API, naming the test responder alone. A
 *      start refused because the canary's walker has an unended journey reads
 *      that journey: started ten minutes or more ago by the database's clock,
 *      it is a leftover of a run that did not finish, and is ended through
 *      "I'm home" before the run starts again, once; younger, another run is
 *      in flight (the old or the new worker's, in a deploy), and this run
 *      skips, reporting nothing, so the one in flight is never cut off;
 *   3. one heartbeat, with no position and no battery level, and a read whose
 *      last contact must be set;
 *   4. silence until just before an alert could open, then a read every
 *      CANARY_POLL_MS until the first that sees the push port's answer to the
 *      responder's lost-contact message, or the first past the deadline. The
 *      verdict is the domain's, on those database times;
 *   5. "I'm home" (D-110), whatever the verdict, so the journey always ends
 *      long before its alert could escalate;
 *   6. a read: the journey ENDED and the alert RESOLVED, both HOME, and no
 *      escalation SMS written;
 *   7. a read every CANARY_POLL_MS until the port has answered the
 *      responder's stand-down, at most CANARY_STAND_DOWN_LIMIT_MS after the
 *      alert's resolution.
 * The outcome is the first failure, or ON_TIME. Once the journey is started,
 * "I'm home" is sent for it once, whatever fails after.
 *
 * A stop (Graphile's abort signal) or the run limit ends a run at once: its
 * journey is ended through "I'm home", waiting at most CANARY_STOP_LIMIT_MS,
 * and the run comes to INTERRUPTED, which is not reported, or RUN_LIMIT,
 * which is. Whatever a stop leaves, the next run's leftover rule ends. An
 * error that is neither a step's failure nor a halt is a fault in the canary
 * itself: the run comes to RUN_FAILED, which is reported, its journey ended
 * the same way. Nothing of that error reaches a line.
 *
 * Then one `canary_run` line, and the report to the canary's own check: ok
 * after ON_TIME alone, failing, which pages at once, after any other
 * outcome, nothing after a stop or a skip. A report that fails is one
 * `canary_report_failed` line. A canary whose settings are unusable reports
 * failing every run with NOT_CONFIGURED: a half-configured canary pages.
 *
 * It never rejects, so Graphile never retries it. It reads no clock and keeps
 * no time of its own (AR-03): every decision is made on the database's now(),
 * read with each observation, and it waits on the Wait it is handed. It
 * changes the database only through the API, apart from its registration,
 * and reads only its own walker's journeys. Its lines hold an outcome, two
 * durations, an HTTP status, a SQLSTATE and a journey's ID, nothing else
 * (PRIV-07).
 */
import {
  CANARY_DEADLINE_MS,
  CANARY_FIRST_LOOK_MS,
  CANARY_POLL_MS,
  CANARY_RUN_LIMIT_MS,
  CANARY_STAND_DOWN_LIMIT_MS,
  CANARY_STOP_LIMIT_MS,
  alertVerdict,
  isLeftover,
  reportFor,
  type CanaryOutcome,
} from '../../domain/canary.ts';
import { sqlstateOf } from '../../domain/sqlstate.ts';
import type {
  CanaryAlarm,
  CanaryCall,
  CanaryClient,
  CanaryObservation,
  CanaryStore,
  Log,
  Wait,
} from '../../ports.ts';

/** What a run came to: an outcome, or a skip because another run is in flight. */
export type CanaryRunResult = { outcome: CanaryOutcome } | { skipped: 'RUN_IN_FLIGHT' };

export interface Canary {
  /** One run. Never rejects. `signal` is Graphile's: when it aborts, the run ends at once. */
  run(signal: AbortSignal): Promise<CanaryRunResult>;
}

/** What a run found, for its line: the outcome, and what the line carries beside it. */
interface Finding {
  outcome: CanaryOutcome;
  alertMs?: number;
  openedAfterMs?: number | null;
  status?: number | null;
  code?: string | null;
}

/** A step failed: the run comes to its finding. */
class StepFailed extends Error {
  readonly finding: Finding;

  constructor(finding: Finding) {
    super(`The canary’s run came to ${finding.outcome}.`);
    this.finding = finding;
  }
}

/** The run was stopped, or reached its limit. */
class Halted extends Error {
  constructor() {
    super('The canary’s run was stopped.');
  }
}

/** What a canary is made with. */
export interface CanaryOptions {
  /** The API's client; null when the canary's settings are unusable, and every run is NOT_CONFIGURED. */
  client: CanaryClient | null;
  /** Why the settings are unusable: the worker says it at start. A run's line has no field for it. */
  notConfigured?: string | undefined;
  store: CanaryStore;
  /** The hash of the canary device's credential; null when there is none. */
  credentialHash: string | null;
  alarm: CanaryAlarm;
  log: Log;
  wait: Wait;
}

export function createCanary({
  client,
  store,
  credentialHash,
  alarm,
  log,
  wait,
}: CanaryOptions): Canary {
  let registered = false;

  return {
    async run(stop: AbortSignal): Promise<CanaryRunResult> {
      // The run's own end: a stop, or the run limit, whichever comes first.
      const halt = new AbortController();
      const halted = new Promise<never>((_resolve, reject) => {
        halt.signal.addEventListener('abort', () => {
          reject(new Halted());
        });
      });
      halted.catch(() => undefined);
      const stopped = () => {
        halt.abort();
      };
      stop.addEventListener('abort', stopped);
      if (stop.aborted) {
        stopped();
      }
      const limit = new AbortController();
      wait(CANARY_RUN_LIMIT_MS, limit.signal).then(stopped, () => undefined);

      /** The work's own result, or Halted as soon as the run ends; nothing is started once it has. */
      const until = <T>(work: () => Promise<T>): Promise<T> =>
        halt.signal.aborted ? Promise.reject(new Halted()) : Promise.race([work(), halted]);

      /** The store's answer, or the step's failure with the SQLSTATE it carried. */
      const fromStore = async <T>(
        work: () => Promise<T>,
        outcome: 'REGISTER_FAILED' | 'READ_FAILED',
      ): Promise<T> => {
        try {
          return await until(work);
        } catch (error) {
          throw error instanceof Halted
            ? error
            : new StepFailed({ outcome, code: sqlstateOf(error) });
        }
      };

      /** The canary's read of one of its own journeys; a journey it cannot read as its own is a failed read. */
      const read = async (journeyId: string): Promise<CanaryObservation> => {
        const seen = await fromStore(() => store.observeCanaryJourney(journeyId), 'READ_FAILED');
        if (seen === null) {
          throw new StepFailed({ outcome: 'READ_FAILED' });
        }
        return seen;
      };

      /** Ends the run's journey through "I'm home", once it has one: sent once, however often it is asked. */
      const own: { end: (() => Promise<CanaryCall<null>>) | null } = { end: null };

      /** Silence, then the watch for the alert, and the verdict on it. */
      const watch = async (journeyId: string, beat: CanaryCall<null>): Promise<Finding> => {
        if (!beat.ok) {
          return { outcome: 'HEARTBEAT_FAILED', status: beat.status };
        }
        const first = await read(journeyId);
        const lastContact = first.journey.lastHeartbeatAt;
        if (lastContact === null) {
          return { outcome: 'HEARTBEAT_FAILED' };
        }
        await until(() =>
          wait(lastContact.getTime() + CANARY_FIRST_LOOK_MS - first.now.getTime(), halt.signal),
        );
        let seen = await read(journeyId);
        while (
          !seen.lostContactAnswered &&
          seen.now.getTime() - lastContact.getTime() <= CANARY_DEADLINE_MS
        ) {
          await until(() => wait(CANARY_POLL_MS, halt.signal));
          seen = await read(journeyId);
        }
        return alertVerdict({
          lastContact,
          openedAt: seen.alert?.openedAt ?? null,
          answeredAt: seen.lostContactAnswered ? seen.now : null,
        });
      };

      /** After "I'm home": the journey and its alert as they must be, and the stand-down answered. */
      const afterHome = async (journeyId: string, verdict: Finding): Promise<Finding> => {
        let seen = await read(journeyId);
        const { journey, alert } = seen;
        if (
          journey.state !== 'ENDED' ||
          journey.endReason !== 'HOME' ||
          alert?.state !== 'RESOLVED' ||
          alert.resolution !== 'HOME' ||
          alert.resolvedAt === null
        ) {
          return { outcome: 'NOT_RESOLVED' };
        }
        if (seen.smsWritten > 0) {
          return { outcome: 'ESCALATED' };
        }
        const resolvedAt = alert.resolvedAt.getTime();
        for (;;) {
          if (seen.now.getTime() - resolvedAt > CANARY_STAND_DOWN_LIMIT_MS) {
            return { outcome: 'STAND_DOWN_NOT_HANDED_OVER' };
          }
          if (seen.standDownAnswered) {
            return verdict;
          }
          await until(() => wait(CANARY_POLL_MS, halt.signal));
          seen = await read(journeyId);
        }
      };

      const steps = async (): Promise<Finding | 'RUN_IN_FLIGHT'> => {
        if (client === null || credentialHash === null) {
          return { outcome: 'NOT_CONFIGURED' };
        }
        if (!registered) {
          await fromStore(() => store.registerCanary({ credentialHash }), 'REGISTER_FAILED');
          registered = true;
        }
        let started = await until(() => client.start());
        if (!started.ok && 'journeyId' in started) {
          const unended = started.journeyId;
          const other = await fromStore(() => store.observeCanaryJourney(unended), 'READ_FAILED');
          if (other === null) {
            // Not the canary walker's journey: nothing of it is the canary's to end.
            return { outcome: 'START_FAILED', status: 409 };
          }
          if (!isLeftover({ startedAt: other.journey.startedAt, now: other.now })) {
            return 'RUN_IN_FLIGHT';
          }
          const ended = await until(() => client.home(unended));
          // A 409 is the API's answer for a journey that ended meanwhile.
          if (!ended.ok && ended.status !== 409) {
            return { outcome: 'START_FAILED', status: ended.status };
          }
          log.write({ event: 'canary_leftover_ended', journeyId: unended });
          started = await until(() => client.start());
        }
        if (!started.ok) {
          return { outcome: 'START_FAILED', status: started.status };
        }
        const journeyId = started.value.journeyId;
        let home: Promise<CanaryCall<null>> | null = null;
        const end = () => (home ??= client.home(journeyId));
        own.end = end;

        const beat = await until(() => client.heartbeat(journeyId));
        let verdict: Finding;
        try {
          verdict = await watch(journeyId, beat);
        } catch (error) {
          if (!(error instanceof StepFailed)) {
            throw error;
          }
          verdict = error.finding;
        }
        const homed = await until(end);
        if (verdict.outcome !== 'ON_TIME') {
          return verdict;
        }
        if (!homed.ok) {
          return { outcome: 'HOME_FAILED', status: homed.status };
        }
        return await afterHome(journeyId, verdict);
      };

      let result: Finding | 'RUN_IN_FLIGHT';
      try {
        result = await steps();
      } catch (error) {
        if (error instanceof StepFailed) {
          result = error.finding;
        } else {
          // Ended before it finished. By the worker's stop: INTERRUPTED, which
          // is not reported, since the next run's leftover rule ends what it
          // leaves. At the run limit: RUN_LIMIT, which pages. By anything else,
          // a fault in the canary itself: RUN_FAILED, which pages too, and
          // whose error no line holds (PRIV-07). Whichever, the journey, if
          // the run started one, is ended through "I'm home", sent once, and
          // waited for at most CANARY_STOP_LIMIT_MS of its own. "I'm home"
          // failing here too changes nothing: the outcome stands, and the run
          // still writes its line and reports.
          if (error instanceof Halted) {
            result = { outcome: stop.aborted ? 'INTERRUPTED' : 'RUN_LIMIT' };
          } else {
            result = { outcome: 'RUN_FAILED' };
          }
          if (own.end !== null) {
            const stopLimit = new AbortController();
            try {
              await Promise.race([own.end(), wait(CANARY_STOP_LIMIT_MS, stopLimit.signal)]);
            } catch {
              // No answer to name: what the run came to stands.
            } finally {
              stopLimit.abort();
            }
          }
        }
      } finally {
        limit.abort();
        stop.removeEventListener('abort', stopped);
      }

      if (result === 'RUN_IN_FLIGHT') {
        log.write({ event: 'canary_skipped', reason: 'RUN_IN_FLIGHT' });
        return { skipped: 'RUN_IN_FLIGHT' };
      }
      log.write({
        event: 'canary_run',
        outcome: result.outcome,
        alertMs: result.alertMs ?? null,
        openedAfterMs: result.openedAfterMs ?? null,
        status: result.status ?? null,
        code: result.code ?? null,
      });
      const status = reportFor(result.outcome);
      if (status !== null) {
        try {
          await alarm.report(status, stop);
        } catch {
          // The monitor is not the database: its failures have no SQLSTATE,
          // and its words may hold its address.
          log.write({ event: 'canary_report_failed' });
        }
      }
      return { outcome: result.outcome };
    },
  };
}
