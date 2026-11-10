import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../prisma/migrations/20261104130000_add_multi_admin_foundation/migration.sql', import.meta.url),
  'utf8',
);
const contractManagementMigration = readFileSync(
  new URL('../prisma/migrations/20261110100000_add_admin_contract_management_permissions/migration.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('Multi-admin foundation migration', () => {
  test('preserves the global roles and adds separate admin tiers', () => {
    const roleEnum = schema.match(/enum Role\s*\{([^}]*)\}/)?.[1];

    expect(roleEnum).toBeDefined();
    expect(roleEnum).toMatch(/\bSEEKER\b/);
    expect(roleEnum).toMatch(/\bEMPLOYER\b/);
    expect(roleEnum).toMatch(/\bADMIN\b/);
    expect(roleEnum).not.toMatch(/STAFF_ADMIN|SUPER_ADMIN/);
    expect(migration).toContain('CREATE TYPE "AdminAccountTier" AS ENUM (\'SUPER_ADMIN\', \'STAFF_ADMIN\')');
    expect(schema).toContain('enum AdminAccountTier {\n  SUPER_ADMIN\n  STAFF_ADMIN\n}');
  });

  test('backfills existing ADMIN users without updating users or sessions', () => {
    expect(migration).toMatch(
      /INSERT INTO "AdminAccount"[\s\S]+?SELECT "id", 'SUPER_ADMIN'::"AdminAccountTier"[\s\S]+?FROM "User"[\s\S]+?WHERE "role" = 'ADMIN'/,
    );
    expect(migration).toMatch(/ON CONFLICT \("userId"\) DO NOTHING/);
    expect(migration).not.toMatch(/\bUPDATE\s+"User"/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+"User"/i);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\s+"User"/i);
    expect(migration).not.toMatch(/\bUPDATE\s+"AuthSession"/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+"AuthSession"/i);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\s+"AuthSession"/i);
    expect(migration).not.toMatch(/CREATE\s+TABLE\s+"AuthSession"/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+"(?:User|AuthSession)"/i);
    expect(migration).toContain('do not use bootstrap-admin.js to create additional');
    expect(readme).toMatch(/do not use `bootstrap-admin\.js` as a staff invitation or provisioning workflow/i);
  });

  test('constrains invitation lifecycle states in PostgreSQL', () => {
    const invitationTable = migration.split('CREATE TABLE "AdminInvitation"')[1].split(');')[0];

    expect(invitationTable).toContain(
      'CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL)',
    );
    expect(invitationTable).toContain(
      'CHECK ("acceptedAt" IS NULL OR "acceptedAt" <= "expiresAt")',
    );
    expect(schema).toContain('acceptedAt  DateTime?');
    expect(schema).toContain('revokedAt   DateTime?');
    expect(schema).toContain('expiresAt   DateTime');
  });

  test('stores current grants separately from historical grant events', () => {
    expect(schema).toContain('model AdminPermissionGrant {');
    expect(schema).toContain('@@id([adminUserId, permissionKey])');
    expect(schema).toContain('model AdminPermissionGrantEvent {');
    expect(schema).toContain('enum AdminPermissionGrantAction {\n  GRANTED\n  REVOKED\n}');
    expect(schema).toMatch(/actorId\s+String/);
    expect(schema).toMatch(/subjectId\s+String/);

    const eventTable = migration.split('CREATE TABLE "AdminPermissionGrantEvent"')[1].split(');')[0];
    expect(eventTable).toContain('"actorId" TEXT NOT NULL');
    expect(eventTable).toContain('"subjectId" TEXT NOT NULL');
    expect(eventTable).toContain('"action" "AdminPermissionGrantAction" NOT NULL');
    expect(eventTable).not.toMatch(/FOREIGN KEY\s*\("(actorId|subjectId)"\)/i);
    expect(eventTable).not.toMatch(/ON DELETE CASCADE/i);
    expect(migration).toContain('"AdminPermissionGrantEvent_append_only"');
    expect(migration).toContain('"AdminPermissionGrantEvent_no_truncate"');
    expect(migration).toContain('"AdminAuditEvent_append_only"');
    expect(migration).toContain('"AdminAuditEvent_no_truncate"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "AdminPermissionGrantEvent"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "AdminAuditEvent"');
    expect(migration).toContain('BEFORE TRUNCATE ON "AdminPermissionGrantEvent"');
    expect(migration).toContain('BEFORE TRUNCATE ON "AdminAuditEvent"');
    expect(migration).toMatch(/"AdminPermissionGrantEvent_no_truncate"[\s\S]+?FOR EACH STATEMENT EXECUTE PROCEDURE "preventAdminHistoryMutation"\(\)/);
    expect(migration).toMatch(/"AdminAuditEvent_no_truncate"[\s\S]+?FOR EACH STATEMENT EXECUTE PROCEDURE "preventAdminHistoryMutation"\(\)/);
  });

  test('preserves audit actor and subject IDs independently of user deletion', () => {
    const auditTable = migration.split('CREATE TABLE "AdminAuditEvent"')[1].split(');')[0];

    expect(auditTable).toContain('"actorId" TEXT NOT NULL');
    expect(auditTable).toContain('"subjectId" TEXT NOT NULL');
    expect(auditTable).toContain('"action" TEXT NOT NULL');
    expect(auditTable).toContain('"createdAt" TIMESTAMP(3) NOT NULL');
    expect(auditTable).not.toMatch(/FOREIGN KEY/i);
  });

  test('stores invitation token hashes and permission assignments', () => {
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
    expect(migration).toContain('"tokenHash" TEXT NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key"');
    expect(migration).toContain('CREATE TABLE "AdminInvitationPermission"');
    expect(migration).not.toMatch(/"token"\s+TEXT/i);
  });

  test('seeds separate financial viewing and execution permissions without staff-management grants', () => {
    expect(migration).toContain('finance.payments.view');
    expect(migration).toContain('finance.withdrawals.view');
    expect(migration).toContain('finance.withdrawals.execute');
    expect(migration).toContain('finance.escrowRelease.execute');
    expect(migration).toContain('finance.providerRecovery.execute');
    expect(migration).not.toMatch(/'staff\.[^']+'/i);
    expect(migration).not.toMatch(/'[^']*(?:staff|admin)[^']*\.(?:invite|permissions|suspend|reactivate)[^']*'/i);
  });

  test('adds contract cancel and archive permissions without granting existing staff access', () => {
    expect(contractManagementMigration).toContain("'contracts.cancel'");
    expect(contractManagementMigration).toContain("'contracts.archive'");
    expect(contractManagementMigration).toContain('ON CONFLICT ("key") DO NOTHING');
    expect(contractManagementMigration).not.toMatch(/INSERT\s+INTO\s+"AdminPermissionGrant"/i);
    expect(contractManagementMigration).not.toMatch(/INSERT\s+INTO\s+"AdminInvitationPermission"/i);
  });
});
