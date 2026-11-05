-- After this migration, do not use bootstrap-admin.js to create additional
-- administrators until a safe Super Admin provisioning mechanism is implemented.
-- This migration does not modify existing ADMIN credentials or sessions.

CREATE TYPE "AdminAccountTier" AS ENUM ('SUPER_ADMIN', 'STAFF_ADMIN');
CREATE TYPE "AdminPermissionGrantAction" AS ENUM ('GRANTED', 'REVOKED');

CREATE TABLE "AdminAccount" (
  "userId" TEXT NOT NULL,
  "tier" "AdminAccountTier" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "AdminAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AdminAccount_tier_idx" ON "AdminAccount"("tier");

CREATE TABLE "AdminPermission" (
  "key" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminPermission_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AdminPermissionGrant" (
  "adminUserId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "grantedById" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminPermissionGrant_pkey" PRIMARY KEY ("adminUserId", "permissionKey"),
  CONSTRAINT "AdminPermissionGrant_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminAccount"("userId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AdminPermissionGrant_permissionKey_fkey"
    FOREIGN KEY ("permissionKey") REFERENCES "AdminPermission"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AdminPermissionGrant_permissionKey_adminUserId_idx"
  ON "AdminPermissionGrant"("permissionKey", "adminUserId");

CREATE TABLE "AdminPermissionGrantEvent" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "action" "AdminPermissionGrantAction" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminPermissionGrantEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminPermissionGrantEvent_permissionKey_fkey"
    FOREIGN KEY ("permissionKey") REFERENCES "AdminPermission"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AdminPermissionGrantEvent_subjectId_permissionKey_createdAt_idx"
  ON "AdminPermissionGrantEvent"("subjectId", "permissionKey", "createdAt");
CREATE INDEX "AdminPermissionGrantEvent_actorId_createdAt_idx"
  ON "AdminPermissionGrantEvent"("actorId", "createdAt");

CREATE TABLE "AdminInvitation" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminInvitation_accepted_revoked_check"
    CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL),
  CONSTRAINT "AdminInvitation_accepted_before_expiry_check"
    CHECK ("acceptedAt" IS NULL OR "acceptedAt" <= "expiresAt")
);

CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");
CREATE INDEX "AdminInvitation_email_expiresAt_idx" ON "AdminInvitation"("email", "expiresAt");
CREATE INDEX "AdminInvitation_createdById_createdAt_idx"
  ON "AdminInvitation"("createdById", "createdAt");

CREATE TABLE "AdminInvitationPermission" (
  "invitationId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  CONSTRAINT "AdminInvitationPermission_pkey" PRIMARY KEY ("invitationId", "permissionKey"),
  CONSTRAINT "AdminInvitationPermission_invitationId_fkey"
    FOREIGN KEY ("invitationId") REFERENCES "AdminInvitation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AdminInvitationPermission_permissionKey_fkey"
    FOREIGN KEY ("permissionKey") REFERENCES "AdminPermission"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AdminInvitationPermission_permissionKey_invitationId_idx"
  ON "AdminInvitationPermission"("permissionKey", "invitationId");

CREATE TABLE "AdminAuditEvent" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "before" JSONB,
  "after" JSONB,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditEvent_actorId_createdAt_idx"
  ON "AdminAuditEvent"("actorId", "createdAt");
CREATE INDEX "AdminAuditEvent_subjectId_createdAt_idx"
  ON "AdminAuditEvent"("subjectId", "createdAt");
CREATE INDEX "AdminAuditEvent_entityType_entityId_createdAt_idx"
  ON "AdminAuditEvent"("entityType", "entityId", "createdAt");

CREATE FUNCTION "preventAdminHistoryMutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Administrative history records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminPermissionGrantEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AdminPermissionGrantEvent"
  FOR EACH ROW EXECUTE FUNCTION "preventAdminHistoryMutation"();

CREATE TRIGGER "AdminPermissionGrantEvent_no_truncate"
  BEFORE TRUNCATE ON "AdminPermissionGrantEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "preventAdminHistoryMutation"();

CREATE TRIGGER "AdminAuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AdminAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "preventAdminHistoryMutation"();

CREATE TRIGGER "AdminAuditEvent_no_truncate"
  BEFORE TRUNCATE ON "AdminAuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "preventAdminHistoryMutation"();

INSERT INTO "AdminPermission" ("key", "module", "description") VALUES
  ('analytics.view', 'analytics', 'View platform analytics'),
  ('fees.view', 'fees', 'View platform fee settings and records'),
  ('fees.manage', 'fees', 'Manage platform fee settings'),
  ('jobs.view', 'jobs', 'View jobs'),
  ('jobs.create', 'jobs', 'Create jobs'),
  ('jobs.edit', 'jobs', 'Edit jobs'),
  ('jobs.delete', 'jobs', 'Delete jobs'),
  ('jobs.moderate', 'jobs', 'Approve or reject jobs'),
  ('applications.view', 'applications', 'View applications'),
  ('applications.update', 'applications', 'Update application status'),
  ('applications.select', 'applications', 'Select applicants and initiate contracts'),
  ('applicants.documents.view', 'applicants', 'View applicant documents'),
  ('companies.view', 'companies', 'View companies'),
  ('companies.edit', 'companies', 'Edit company records'),
  ('verification.view', 'verification', 'View verification submissions'),
  ('verification.documents.view', 'verification', 'View verification documents'),
  ('verification.approve', 'verification', 'Approve verification submissions'),
  ('verification.reject', 'verification', 'Reject verification submissions'),
  ('users.view', 'users', 'View user records'),
  ('users.anonymize', 'users', 'Anonymize user accounts'),
  ('contracts.view', 'contracts', 'View contracts'),
  ('contracts.confirm', 'contracts', 'Confirm contracts'),
  ('contracts.complete', 'contracts', 'Complete contracts'),
  ('disputes.view', 'disputes', 'View disputes'),
  ('disputes.resolve', 'disputes', 'Resolve disputes'),
  ('finance.payments.view', 'finance', 'View payment records'),
  ('finance.conversions.view', 'finance', 'View currency conversion records'),
  ('finance.withdrawals.view', 'finance', 'View withdrawal records'),
  ('finance.contractFunding.view', 'finance', 'View contract funding records'),
  ('finance.audit.view', 'finance', 'View financial audit records'),
  ('finance.contractFunding.execute', 'finance', 'Execute contract funding operations'),
  ('finance.escrowRelease.execute', 'finance', 'Execute escrow releases'),
  ('finance.withdrawals.execute', 'finance', 'Execute withdrawals'),
  ('finance.withdrawals.reconcile', 'finance', 'Reconcile withdrawals'),
  ('finance.providerRecovery.execute', 'finance', 'Execute provider transfer recovery'),
  ('subscriptions.view', 'subscriptions', 'View subscriptions'),
  ('subscriptions.plans.manage', 'subscriptions', 'Manage subscription plans'),
  ('subscriptions.trials.manage', 'subscriptions', 'Manage subscription trials'),
  ('content.view', 'content', 'View website content'),
  ('content.edit', 'content', 'Edit website content'),
  ('content.publish', 'content', 'Publish website content'),
  ('content.media.upload', 'content', 'Upload website content media'),
  ('communications.templates.view', 'communications', 'View email templates'),
  ('communications.templates.edit', 'communications', 'Edit email templates'),
  ('communications.campaigns.view', 'communications', 'View email campaigns'),
  ('communications.campaigns.manage', 'communications', 'Create and manage email campaigns'),
  ('communications.campaigns.send', 'communications', 'Send email campaigns'),
  ('support.view', 'support', 'View premium support requests'),
  ('support.update', 'support', 'Update premium support requests'),
  ('notifications.view', 'notifications', 'View administrative notifications'),
  ('notifications.manage', 'notifications', 'Manage administrative notifications');

INSERT INTO "AdminAccount" ("userId", "tier", "createdAt", "updatedAt")
SELECT "id", 'SUPER_ADMIN'::"AdminAccountTier", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "role" = 'ADMIN'
ON CONFLICT ("userId") DO NOTHING;
