import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(testDirectory, '../prisma/migrations/20260917123000_complete_employer_verification_dossier/migration.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

describe('Employer verification dossier migration', () => {
  test('uses transaction-safe enum recreation for the supporting document kind', () => {
    expect(migrationSql).not.toMatch(/ALTER TYPE[\s\S]+ADD VALUE/i);
    expect(migrationSql).toContain('ALTER TYPE "EmployerVerificationDocumentKind" RENAME TO "EmployerVerificationDocumentKind_old"');
    expect(migrationSql).toContain("'IDENTITY_SUPPORTING'");
    expect(migrationSql).toContain('USING ("kind"::text::"EmployerVerificationDocumentKind")');
    expect(migrationSql).toContain('DROP TYPE "EmployerVerificationDocumentKind_old"');
  });

  test('retains all dossier columns required by the final schema', () => {
    expect(migrationSql).toContain('ADD COLUMN "address" TEXT');
    expect(migrationSql).toContain('ADD COLUMN "registrationNumber" TEXT');
    expect(migrationSql).toContain('ADD COLUMN "registrationType" TEXT');
    expect(migrationSql).toContain('ADD COLUMN "fileSize" INTEGER');
  });
});
