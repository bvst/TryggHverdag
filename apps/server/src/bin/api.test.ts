// GRP-01-AC8, in this process: what bin/api.ts does with ADMIN_BOOTSTRAP_CODE.
//
// bin.test.ts runs the entry file the way Clever Cloud does, as a plain node
// child, and holds its start line from outside. The coverage run (RG-04) does
// not follow a child, so the two branches that choose the line, and the code
// handed to the API, were never measured. And from outside, what the entry file
// hands startApiProcess cannot be seen at all: a start line saying the first
// admin can join, beside an API handed no code, passed every test there while no
// first admin could ever join.
//
// So this imports the entry file itself, as BUG-52 did for gate-file.mjs, with
// the two modules it hands the work to stood in for: runMain, so the start-up
// runs here rather than as a process that exits, and exitOnSignal, so nothing is
// bound to this test run's own signals; and startApiProcess, so no pool and no
// port are opened. The settings are read by the real config.ts. Every stand-in,
// variable and spy is put back before each test returns.
import { syntheticBootstrapCode } from '@trygghverdag/test-kit';
import process from 'node:process';
import { describe, expect, test, vi } from 'vitest';

/** Stands in for the database's address. Never connected to: startApiProcess is a stand-in. */
const DATABASE_URL = 'postgres://staging:sentinel-pw-7@127.0.0.1:1/app';

interface Started {
  /** The name the entry file gave runMain. */
  name: string | undefined;
  /** Every line the entry file wrote to stderr while it started. */
  lines: string[];
  /** Everything it wrote to stderr, as written. */
  written: string;
  startApiProcess: ReturnType<typeof vi.fn>;
  exitOnSignal: ReturnType<typeof vi.fn>;
  /** The stop of the API the stand-in started. */
  stop: () => Promise<void>;
}

/**
 * Loads a fresh copy of bin/api.ts with ADMIN_BOOTSTRAP_CODE set to `code`
 * (undefined: unset) and runs the start-up it hands runMain, to its end.
 */
async function startedWith(code: string | undefined): Promise<Started> {
  let name: string | undefined;
  let main: (() => Promise<void>) | undefined;
  const stop = vi.fn(() => Promise.resolve());
  const startApiProcess = vi.fn<(config: unknown, options: unknown) => Promise<unknown>>(() =>
    Promise.resolve({ port: 8080, stop }),
  );
  const exitOnSignal = vi.fn();
  let written = '';
  vi.resetModules();
  vi.doMock('../process.ts', () => ({
    runMain: (given: string, start: () => Promise<void>) => {
      name = given;
      main = start;
    },
    exitOnSignal,
  }));
  vi.doMock('../api-process.ts', () => ({ startApiProcess }));
  vi.stubEnv('DATABASE_URL', DATABASE_URL);
  vi.stubEnv('POSTGRESQL_ADDON_URI', undefined);
  vi.stubEnv('PORT', undefined);
  vi.stubEnv('ADMIN_BOOTSTRAP_CODE', code);
  const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    written += String(chunk);
    return true;
  });
  try {
    await import('./api.ts');
    if (main === undefined) {
      throw new Error('bin/api.ts handed runMain no start-up.');
    }
    await main();
  } finally {
    write.mockRestore();
    vi.unstubAllEnvs();
    vi.doUnmock('../process.ts');
    vi.doUnmock('../api-process.ts');
    vi.resetModules();
  }
  return {
    name,
    lines: written.split('\n').filter((line) => line !== ''),
    written,
    startApiProcess,
    exitOnSignal,
    stop,
  };
}

describe('bin/api.ts and the first admin’s bootstrap code, in this process (GRP-01)', () => {
  test('GRP-01-AC8: with ADMIN_BOOTSTRAP_CODE unset, the entry file says so in one line naming the setting, and hands the API no code', async () => {
    const started = await startedWith(undefined);

    expect(started.lines).toHaveLength(1);
    expect(started.lines[0]).toContain('ADMIN_BOOTSTRAP_CODE');
    expect(started.startApiProcess).toHaveBeenCalledTimes(1);
    expect(started.startApiProcess).toHaveBeenCalledWith(
      expect.objectContaining({ databaseUrl: DATABASE_URL }),
      { bootstrapCode: null },
    );
  });

  test('GRP-01-AC8: with a usable code, the entry file says in one line, a line of its own, that the first admin can join, never the code, and hands the API the code as config.ts normalises it', async () => {
    // Upper-case hex, as Terraform makes it; set here in lower case, so the
    // code handed on is the normalised one and not the setting as written.
    const value = syntheticBootstrapCode();

    const usable = await startedWith(value.toLowerCase());
    const unset = await startedWith(undefined);

    expect(usable.lines).toHaveLength(1);
    expect(usable.lines[0]).toContain('ADMIN_BOOTSTRAP_CODE');
    expect(usable.lines[0]).not.toBe(unset.lines[0]);
    expect(usable.written.toUpperCase()).not.toContain(value);
    expect(usable.startApiProcess).toHaveBeenCalledTimes(1);
    expect(usable.startApiProcess).toHaveBeenCalledWith(
      expect.objectContaining({ databaseUrl: DATABASE_URL }),
      { bootstrapCode: value },
    );
  });

  test('GRP-01-AC8: with an unusable value, the entry file says so in one line naming the setting, never the value, not the usable line, and hands the API no code', async () => {
    const value = `${syntheticBootstrapCode().slice(0, 18)}!`;

    const unusable = await startedWith(value);
    const usable = await startedWith(syntheticBootstrapCode());

    expect(unusable.lines).toHaveLength(1);
    expect(unusable.lines[0]).toContain('ADMIN_BOOTSTRAP_CODE');
    expect(unusable.lines[0]).not.toBe(usable.lines[0]);
    expect(unusable.written.toUpperCase()).not.toContain(value.slice(0, 18));
    expect(unusable.startApiProcess).toHaveBeenCalledWith(
      expect.objectContaining({ databaseUrl: DATABASE_URL }),
      { bootstrapCode: null },
    );
  });

  test('GRP-01-AC8: the start-up runs under runMain as the API, and the API it started stops on the platform’s signals', async () => {
    const started = await startedWith(syntheticBootstrapCode());

    expect(started.name).toBe('API');
    expect(started.exitOnSignal).toHaveBeenCalledTimes(1);
    expect(started.exitOnSignal).toHaveBeenCalledWith({
      name: 'API',
      signals: process,
      stop: started.stop,
    });
  });
});
