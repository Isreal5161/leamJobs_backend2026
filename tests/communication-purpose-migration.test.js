import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../prisma/migrations/20261103090000_add_communication_purposes/migration.sql', import.meta.url),
  'utf8',
);

test('existing campaigns default to promotional purpose without changing user consent', () => {
  expect(migration).toContain(
    `ADD COLUMN "purpose" "CommunicationPurpose" NOT NULL DEFAULT 'PROMOTIONAL_MARKETING'`,
  );
  expect(migration).toContain(`ADD COLUMN "operationalContentConfirmed" BOOLEAN NOT NULL DEFAULT false`);
  expect(migration).not.toMatch(/UPDATE\s+"User"\s+SET\s+"marketingEmailsEnabled"/i);
});
