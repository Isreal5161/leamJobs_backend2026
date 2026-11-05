import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../prisma/migrations/20261104143000_add_admin_staff_suspension/migration.sql', import.meta.url),
  'utf8',
);

test('AdminAccount suspension state is nullable and added by a new migration', () => {
  expect(schema).toMatch(/model AdminAccount\s*\{[^}]*suspendedAt\s+DateTime\?/s);
  expect(migration).toMatch(/ALTER TABLE "AdminAccount"\s+ADD COLUMN "suspendedAt" TIMESTAMP\(3\);/);
  expect(migration).not.toMatch(/UPDATE|DELETE|DROP|TRUNCATE/i);
});
