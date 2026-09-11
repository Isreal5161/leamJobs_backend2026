-- Additive Phase 3 completion confirmation timestamp.
ALTER TABLE "FreelanceContract"
  ADD COLUMN "employerCompletionConfirmedAt" TIMESTAMP(3);