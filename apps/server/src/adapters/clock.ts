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
import type { Clock } from '../ports.ts';
import type { Database } from './db.ts';

export function databaseClock(db: Database): Clock {
  return {
    async now(): Promise<Date> {
      const result = await db.execute<{ now: Date }>(sql`select now() as now`);
      const row = result.rows[0];
      if (row === undefined) {
        // `select now()` returning nothing is not a case to paper over with a
        // local time: it means the database is not answering, and a safety
        // decision made on a guessed clock is worse than no answer.
        throw new Error('The database did not return a time, so nothing can be timed against it.');
      }
      return row.now;
    },
  };
}
