INSERT INTO "Escrow" (
    "id",
    "freelanceContractId",
    "grossAmount",
    "platformFeeAmount",
    "seekerNetAmount",
    "currency",
    "status",
    "updatedAt"
)
SELECT
    'escrow_backfill_' || fc."contractId",
    fc."contractId",
    fc."agreedAmount",
    fc."platformFeeAmount",
    fc."seekerNetAmount",
    fc."currency",
    'UNFUNDED'::"EscrowStatus",
    CURRENT_TIMESTAMP
FROM "FreelanceContract" AS fc
JOIN "Contract" AS c ON c."id" = fc."contractId"
JOIN "Application" AS a ON a."id" = c."applicationId"
WHERE c."type" = 'FREELANCE_PROJECT'
  AND (
      (c."status" = 'PENDING'
          AND fc."workStatus" = 'PENDING'
          AND NOT (fc."employerConfirmedAt" IS NOT NULL AND fc."seekerConfirmedAt" IS NOT NULL))
      OR
      (c."status" = 'ACTIVE'
          AND fc."workStatus" = 'PENDING'
          AND fc."employerConfirmedAt" IS NOT NULL
          AND fc."seekerConfirmedAt" IS NOT NULL)
  )
  AND a."status" = 'ACCEPTED'
  AND fc."agreedAmount" > 0
  AND fc."currency" ~ '^[A-Z]{3}$'
  AND fc."platformFeePercentage" BETWEEN 0 AND 100
  AND fc."platformFeeAmount" >= 0
  AND fc."platformFeeAmount" = ROUND(fc."agreedAmount" * fc."platformFeePercentage" / 100, 2)
  AND (
      fc."seekerNetAmount" = fc."agreedAmount"
      OR fc."seekerNetAmount" = fc."agreedAmount" - fc."platformFeeAmount"
  )
  AND CASE
      WHEN fc."seekerNetAmount" = fc."agreedAmount"
          THEN fc."agreedAmount" + fc."platformFeeAmount"
      ELSE fc."agreedAmount"
  END <= 9999999999.99
  AND NOT EXISTS (
      SELECT 1
      FROM "Escrow" AS e
      WHERE e."freelanceContractId" = fc."contractId"
  )
  AND NOT EXISTS (
      SELECT 1
      FROM "Payment" AS p
      WHERE p."paymentType" = 'CONTRACT_FUNDING'
        AND p."metadata" ->> 'contractId' = c."id"
  )
  AND NOT EXISTS (
      SELECT 1
      FROM "FinancialLedgerEntry" AS le
      WHERE le."contractId" = c."id"
  )
  AND NOT EXISTS (
      SELECT 1
      FROM "Dispute" AS d
      WHERE d."contractId" = c."id"
  )
ON CONFLICT ("freelanceContractId") DO NOTHING;
