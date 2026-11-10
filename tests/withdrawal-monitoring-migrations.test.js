import { readFileSync } from 'node:fs';

const migrationRoot = new URL('../prisma/migrations/', import.meta.url);
const reconciliationMigration = readFileSync(
  new URL('20261110170000_track_withdrawals_and_attempt_updates/migration.sql', migrationRoot),
  'utf8',
).trim();
const payoutAttemptTimestampMigration = readFileSync(
  new URL('20261110171000_add_payout_attempt_updated_at/migration.sql', migrationRoot),
  'utf8',
).trim();
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

test('withdrawal monitoring migrations isolate PostgreSQL 10 enum and column changes in order', () => {
  expect(reconciliationMigration).toBe('ALTER TYPE "FinancialAction" ADD VALUE \'RECONCILED\';');
  expect(payoutAttemptTimestampMigration).toBe('ALTER TABLE "PayoutAttempt" ADD COLUMN "updatedAt" TIMESTAMP(3);');
  expect('20261110170000_track_withdrawals_and_attempt_updates'
    .localeCompare('20261110171000_add_payout_attempt_updated_at')).toBeLessThan(0);
});

test('PayoutAttempt updatedAt remains nullable and Prisma-managed', () => {
  expect(schema).toMatch(/model PayoutAttempt\s*\{[^}]*updatedAt\s+DateTime\?\s+@updatedAt[^}]*\}/s);
});
