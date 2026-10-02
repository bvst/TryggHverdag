/**
 * Starting a journey: read the walker's situation, ask the state machine,
 * write what it decided (SM-01, SM-02).
 *
 * Thin on purpose, like every module. The decision is the domain's, where it
 * is tested in milliseconds; the one-unended-journey rule is also the
 * database's, where two racing starts meet. What is left here is the order of
 * the calls, and what the store's answers mean to the caller.
 *
 * The time comes from the injected clock, which in the API is the database
 * clock, never from this process.
 */
import type { StartJourneyResponse } from '@trygghverdag/contracts';
import { transition, type StartRefusal } from '../../domain/journey.ts';
import type { Clock, JourneyStore } from '../../ports.ts';

/** A start, as the API hands it over: the walker is the device's own user. */
export interface StartRequest {
  walkerId: string;
  responderIds: readonly string[];
}

export type StartResult = { type: 'started'; journey: StartJourneyResponse } | StartRefusal;

export interface JourneyService {
  start(request: StartRequest): Promise<StartResult>;
}

export function createJourneyService({
  clock,
  journeys,
}: {
  clock: Clock;
  journeys: JourneyStore;
}): JourneyService {
  return {
    async start({ walkerId, responderIds }: StartRequest): Promise<StartResult> {
      const current = await journeys.unendedJourneyOf(walkerId);
      const existingUserIds = await journeys.existingUsers(responderIds);

      const decision = transition(current, {
        type: 'start',
        walkerId,
        responderIds,
        existingUserIds,
      });
      if (decision.type === 'refused') {
        return decision;
      }

      const startedAt = await clock.now();
      const stored = await journeys.insertStarted({
        walkerId,
        responderIds: decision.responderIds,
        startedAt,
      });
      if (!stored.inserted) {
        // Another start for this walker got past the read above at the same
        // moment and won at the database. To the caller that is the same
        // refusal the read would have given, with the journey that won.
        return {
          type: 'refused',
          reason: 'ALREADY_ON_A_JOURNEY',
          journeyId: stored.unendedJourneyId,
        };
      }

      return {
        type: 'started',
        journey: {
          journeyId: stored.journeyId,
          state: decision.state,
          startedAt: startedAt.toISOString(),
        },
      };
    },
  };
}
