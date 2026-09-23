import { defineConfig } from 'drizzle-kit';

/**
 * How migrations are generated. `pnpm run db:generate` writes SQL from the
 * schema; the same SQL runs in tests, staging and production, so a migration
 * that works nowhere else cannot work in a test either.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});
