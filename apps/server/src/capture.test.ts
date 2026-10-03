// The capture the server's privacy tests read, in one place (PRIV-07;
// LOST-01-AC14; SM-01-AC11's capture).
//
// "Nothing of a heartbeat reaches a log" is proven by running each outcome
// with stdout, stderr and the console captured, and finding none of the
// heartbeat's values in what was written. Two things make that proof worth
// anything, and both live here:
//   - `captured(run)` sees everything written while `run` runs, and a turn
//     after it: a line written on the next tick, by a timer of 0 or on the
//     next turn of the event loop is still caught, because the spies stay in
//     place until those have run. A capture that closed the moment the
//     request resolved would miss a write its handler had put off, and pass
//     (test-auditor, LOST-01);
//   - `markersOf(heartbeat)` is every text a careless line could print of a
//     heartbeat, and `markersIn(text, markers)` the ones a text holds.
//
// One copy, used by the system tests (journeys.system.test.ts, L6) and the
// adapter's integration test (adapters/journeys.integration.test.ts, L3),
// where there were two. The test kit cannot hold it: it has no Node types,
// and the app uses it too.
//
// Named like a test because it is one. It holds the controls that prove the
// capture sees what it must, and a test file importing it runs those
// controls in its own run as well, so each file that relies on the capture
// proves it where it relies on it, L3 included. The name also keeps it among
// the files the no-test-weakened check (RG-03) and test-auditor watch.
import {
  syntheticHeartbeat,
  syntheticPosition,
  syntheticUuid,
  toStoredPosition,
  type HeartbeatToRecord,
  type SyntheticHeartbeat,
} from '@trygghverdag/test-kit';
import process from 'node:process';
import { inspect } from 'node:util';
import { describe, expect, test, vi } from 'vitest';

/** One turn of the event loop: a timer of 0, then the next check phase. */
async function aTurnLater(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Everything written to stdout, stderr or the console while `run` runs, and
 * a turn after it settles. Vitest routes the console through its own
 * streams, not through process.stdout, so both are watched. The spies are
 * restored once that turn is over, whether `run` resolved or rejected, and a
 * rejection is passed on.
 */
export async function captured<T>(run: () => Promise<T>): Promise<{ result: T; written: string }> {
  const pieces: string[] = [];
  const keep = (value: unknown): void => {
    if (typeof value === 'string') {
      pieces.push(value);
    } else if (value instanceof Uint8Array) {
      pieces.push(Buffer.from(value).toString('utf8'));
    } else {
      pieces.push(inspect(value, { depth: 10 }));
    }
  };
  const spies = [
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      keep(chunk);
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      keep(chunk);
      return true;
    }),
    ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
        args.forEach(keep);
      }),
    ),
  ];
  let result: T;
  try {
    result = await run();
  } finally {
    // A write put off until after the answer is still a write.
    await aTurnLater();
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
  return { result, written: pieces.join('\n') };
}

/** A heartbeat as a test holds it: as the phone sends it, or as the store takes it. */
export type MarkedHeartbeat = SyntheticHeartbeat | HeartbeatToRecord;

/**
 * Every text a careless line could print of this heartbeat: each coordinate
 * in full and rounded to 3, 4, 5, 6 and 7 decimals, the accuracy, the battery
 * level, the phone's time (as sent, as ISO, as PostgreSQL prints it, and as a
 * number), and the event ID.
 */
export function markersOf(heartbeat: MarkedHeartbeat): string[] {
  const { position } = heartbeat;
  const phoneTimes = (recordedAt: string | Date): string[] => {
    const instant = new Date(recordedAt);
    const asSent = typeof recordedAt === 'string' ? [recordedAt] : [];
    if (Number.isNaN(instant.getTime())) {
      return asSent;
    }
    const iso = instant.toISOString();
    return [
      ...asSent,
      iso,
      // As PostgreSQL prints a timestamptz in UTC, to the second.
      iso.replace('T', ' ').replace(/\.\d+Z$/, ''),
      String(instant.getTime()),
    ];
  };
  return [
    ...new Set([
      ...(position === null
        ? []
        : [position.latitude, position.longitude].flatMap((value) => [
            String(value),
            ...[3, 4, 5, 6, 7].map((decimals) => value.toFixed(decimals)),
          ])),
      ...(position === null
        ? []
        : [String(position.accuracyMeters), ...phoneTimes(position.recordedAt)]),
      ...(heartbeat.batteryLevel === null ? [] : [String(heartbeat.batteryLevel)]),
      heartbeat.eventId,
    ]),
  ];
}

/** The markers found in this text: none, if nothing of the heartbeat is in it. */
export function markersIn(text: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => text.includes(marker));
}

// ---------------------------------------------------------------------------
// The controls: without them, finding nothing in the capture could mean only
// that the capture was blind.
// ---------------------------------------------------------------------------

/** What the capture replaces, each read as it is now, unbound. */
const WATCHED: { name: string; current: () => unknown }[] = [
  { name: 'process.stdout.write', current: () => Reflect.get(process.stdout, 'write') },
  { name: 'process.stderr.write', current: () => Reflect.get(process.stderr, 'write') },
  ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((name) => ({
    name: `console.${name}`,
    current: () => Reflect.get(console, name),
  })),
];

/** Ways a write can be put off until after `run` has resolved. */
const LATE_WRITES: { how: string; putOff: (write: () => void) => void }[] = [
  {
    how: 'on the next turn, by setImmediate',
    putOff: (write) => {
      setImmediate(write);
    },
  },
  {
    how: 'by a timer of 0',
    putOff: (write) => {
      setTimeout(write, 0);
    },
  },
  {
    how: 'on the next tick',
    putOff: (write) => {
      process.nextTick(write);
    },
  },
  {
    how: 'in a microtask',
    putOff: (write) => {
      queueMicrotask(write);
    },
  },
];

describe('PRIV-07: the capture sees everything written, a turn late included', () => {
  test('LOST-01-AC14: (control) the capture sees stdout, stderr and every console method, as text, as bytes and as objects', async () => {
    const marker = syntheticUuid();

    const { written } = await captured(() => {
      process.stdout.write(`out ${marker}\n`);
      process.stderr.write(Buffer.from(`err ${marker}\n`));
      console.log({ nested: { deeper: marker } });
      console.info(`info ${marker}`);
      console.warn(`warn ${marker}`);
      console.error(new Error(`error ${marker}`));
      console.debug(`debug ${marker}`);
      console.trace(`trace ${marker}`);
      return Promise.resolve();
    });

    expect(written.split(marker).length - 1).toBe(8);
  });

  test.each(LATE_WRITES)(
    'LOST-01-AC14: (control) a write put off until after run has resolved is still caught — $how',
    async ({ putOff }) => {
      const marker = syntheticUuid();

      const { result, written } = await captured(() => {
        putOff(() => {
          process.stderr.write(`late ${marker}\n`);
          console.error(new Error(`late ${marker}`));
        });
        return Promise.resolve('answered');
      });

      expect(result).toBe('answered');
      expect(written.split(marker).length - 1).toBe(2);
    },
  );

  test('LOST-01-AC14: (control) when run rejects, the rejection is passed on, and the capture is still in place for a write put off until the next turn', async () => {
    let capturedWhenLate: boolean[] = [];

    await expect(
      captured(() => {
        setImmediate(() => {
          capturedWhenLate = WATCHED.map(({ current }) => vi.isMockFunction(current()));
        });
        return Promise.reject(new Error('the run failed'));
      }),
    ).rejects.toThrow('the run failed');

    expect(capturedWhenLate).toEqual(WATCHED.map(() => true));
  });

  test('LOST-01-AC14: (control) once the capture is over, stdout, stderr and the console are their own again, whether run resolved or rejected', async () => {
    const before = WATCHED.map(({ current }) => current());

    await captured(() => Promise.resolve());
    expect(WATCHED.map(({ current }) => current())).toEqual(before);

    await expect(captured(() => Promise.reject(new Error('the run failed')))).rejects.toThrow();
    expect(WATCHED.map(({ current }) => current())).toEqual(before);
    expect(WATCHED.filter(({ current }) => vi.isMockFunction(current()))).toEqual([]);
  });
});

describe('PRIV-07: the markers are every text a careless line could print of a heartbeat', () => {
  test('LOST-01-AC14: markersOf holds each coordinate in full and at 3 to 7 decimals, the accuracy, the battery level, the phone’s time as sent, as ISO, as PostgreSQL prints it and as a number, and the event ID', () => {
    const position = syntheticPosition();
    const body = syntheticHeartbeat({ journeyId: syntheticUuid(), position });
    const instant = new Date(position.recordedAt);

    const markers = markersOf(body);

    const expected = [
      ...[position.latitude, position.longitude].flatMap((value) => [
        String(value),
        value.toFixed(3),
        value.toFixed(4),
        value.toFixed(5),
        value.toFixed(6),
        value.toFixed(7),
      ]),
      String(position.accuracyMeters),
      position.recordedAt,
      instant.toISOString(),
      instant.toISOString().replace('T', ' ').slice(0, 19),
      String(instant.getTime()),
      String(body.batteryLevel),
      body.eventId,
    ];
    expect([...markers].sort()).toEqual([...new Set(expected)].sort());
  });

  test('LOST-01-AC14: a heartbeat as the store takes it, its phone time a Date, has the same markers as the body it came from', () => {
    const body = syntheticHeartbeat({ journeyId: syntheticUuid(), position: syntheticPosition() });
    const position = body.position;
    if (position === null) {
      throw new Error('this test needs a heartbeat with a position');
    }
    const stored: HeartbeatToRecord = {
      journeyId: body.journeyId,
      eventId: body.eventId,
      receivedAt: new Date(position.recordedAt),
      batteryLevel: body.batteryLevel,
      position: toStoredPosition(position),
    };

    expect([...markersOf(stored)].sort()).toEqual([...markersOf(body)].sort());
  });

  test('LOST-01-AC14: what a heartbeat does not hold has no marker: with no position and an unknown battery level, only the event ID', () => {
    const body = syntheticHeartbeat({
      journeyId: syntheticUuid(),
      position: null,
      batteryLevel: null,
    });

    expect(markersOf(body)).toEqual([body.eventId]);
  });

  test('LOST-01-AC14: markersIn names exactly the markers a text holds', () => {
    const body = syntheticHeartbeat({ journeyId: syntheticUuid(), position: syntheticPosition() });
    const markers = markersOf(body);

    expect(markersIn('', markers)).toEqual([]);
    expect(markersIn(`line ${body.eventId} end`, markers)).toEqual([body.eventId]);
    expect(markersIn(markers.join(' '), markers)).toEqual(markers);
  });
});
