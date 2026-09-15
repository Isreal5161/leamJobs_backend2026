-- Replace the current-subscription constraint so plan upgrades can stage a pending subscription.
DROP INDEX "Subscription_one_current_per_user_idx";

-- A user may have one ACTIVE subscription; PENDING upgrades may coexist temporarily.
CREATE UNIQUE INDEX "Subscription_one_active_per_user_idx"
  ON "Subscription"("userId")
  WHERE "status" = 'ACTIVE';
