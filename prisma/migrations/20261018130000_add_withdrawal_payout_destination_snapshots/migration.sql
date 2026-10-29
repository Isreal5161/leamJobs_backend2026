ALTER TABLE "Withdrawal"
  ADD COLUMN "payoutMethodSnapshot" "PayoutMethod",
  ADD COLUMN "payoutCountrySnapshot" TEXT,
  ADD COLUMN "bankCodeSnapshot" TEXT,
  ADD COLUMN "bankNameSnapshot" TEXT,
  ADD COLUMN "accountNameSnapshot" TEXT,
  ADD COLUMN "encryptedAccountNumberSnapshot" TEXT,
  ADD COLUMN "accountNumberLast4Snapshot" TEXT,
  ADD COLUMN "payoutAccountVerifiedAtSnapshot" TIMESTAMP(3);
