/**
 * The clock, read from the database (REL-01, AR-03).
 *
 * Not `new Date()`. The API and the worker are separate processes, and on a
 * managed platform they are separate machines whose clocks drift apart. Every
 * safety decision in this system is "has it been more than N minutes", so two
 * processes disagreeing about now means two processes disagreeing about whether
 * someone is overdue. The database is the one clock they already share.
 */
import { sql } from 'drizzle-orm';
import { databaseTime } from '../domain/database-time.ts';
import type { Clock } from '../ports.ts';
import type { Database } from './db.ts';

export function databaseClock(db: Database): Clock {
  return {
    async now(): Promise<Date> {
      // `unknown`, not `{ now: Date }`. Drizzle's execute does not map a raw
      // query's columns — it only maps columns it knows from the schema — so
      // this comes back as PostgreSQL's own text. Naming it `Date` here is what
      // let the first version of this file ship a value that had no getTime(),
      // and the type argument is exactly what hid it from the compiler.
      const result = await db.execute<{ now: unknown }>(sql`select now() as now`);
      const row = result.rows[0];
      if (row === undefined) {
        // `select now()` returning nothing is not a case to paper over with a
        // local time: it means the database is not answering, and a safety
        // decision made on a guessed clock is worse than no answer.
        //
        // This branch is deliberately unverified: PostgreSQL always returns a
        // row for `select now()`, so there is no way to provoke it without
        // faking the driver, and faking the driver would only prove the fake.
        // It is defence in depth against a future query shape, and saying so
        // here is better than leaving a reader to wonder which it is.
        throw new Error('The database did not return a time, so nothing can be timed against it.');
      }
      return databaseTime(row.now, 'The database clock');
    },
  };
}
