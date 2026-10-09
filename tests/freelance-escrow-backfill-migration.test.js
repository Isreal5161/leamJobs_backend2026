import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../prisma/migrations/20261009045600_backfill_unfunded_freelance_escrows/migration.sql', import.meta.url),
  'utf8',
).replace(/\s+/g, ' ');
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const initialMigration = readFileSync(
  new URL('../prisma/migrations/20260902140000_initial_domain_schema/migration.sql', import.meta.url),
  'utf8',
);

test('freelance escrow backfill uses the current schema and PostgreSQL 10-compatible SQL', () => {
  expect(migration).toContain('INSERT INTO "Escrow"');
  expect(migration).toContain('"freelanceContractId", "grossAmount", "platformFeeAmount", "seekerNetAmount", "currency", "status", "updatedAt"');
  expect(migration).toContain("'escrow_backfill_' || fc.\"contractId\"");
  expect(migration).not.toContain('gen_random_uuid');
  expect(migration).toContain("'UNFUNDED'::\"EscrowStatus\"");
  expect(schema).toContain('model Escrow {');
  expect(schema).toContain('freelanceContractId String       @unique');
  expect(initialMigration).toContain('"Escrow_freelanceContractId_key" ON "Escrow"("freelanceContractId")');
  expect(initialMigration).toContain('"Escrow_freelanceContractId_fkey" FOREIGN KEY ("freelanceContractId") REFERENCES "FreelanceContract"("contractId")');
});

test('freelance escrow backfill is idempotent and excludes financial or lifecycle contradictions', () => {
  expect(migration).toContain('WHERE e."freelanceContractId" = fc."contractId"');
  expect(migration).toContain('ON CONFLICT ("freelanceContractId") DO NOTHING');
  expect(migration).toContain("c.\"type\" = 'FREELANCE_PROJECT'");
  expect(migration).toContain("a.\"status\" = 'ACCEPTED'");
  expect(migration).toContain("c.\"status\" = 'PENDING'");
  expect(migration).toContain("c.\"status\" = 'ACTIVE'");
  expect(migration).toContain("fc.\"workStatus\" = 'PENDING'");
  expect(migration).toContain("fc.\"employerConfirmedAt\" IS NOT NULL");
  expect(migration).toContain("fc.\"seekerConfirmedAt\" IS NOT NULL");
  expect(migration).toContain('p."metadata" ->> \'contractId\' = c."id"');
  expect(migration).toContain('le."contractId" = c."id"');
  expect(migration).toContain('d."contractId" = c."id"');
  expect(migration).toContain('fc."platformFeeAmount" = ROUND(fc."agreedAmount" * fc."platformFeePercentage" / 100, 2)');
  expect(migration).toContain('END <= 9999999999.99');
});
