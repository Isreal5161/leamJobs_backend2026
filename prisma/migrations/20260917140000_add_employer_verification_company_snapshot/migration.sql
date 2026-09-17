-- Store the company information submitted for verification review.
ALTER TABLE "EmployerVerification"
    ADD COLUMN "companyName" TEXT,
    ADD COLUMN "companyDescription" TEXT,
    ADD COLUMN "website" TEXT,
    ADD COLUMN "industry" TEXT,
    ADD COLUMN "companySize" TEXT,
    ADD COLUMN "location" TEXT,
    ADD COLUMN "address" TEXT,
    ADD COLUMN "state" TEXT,
    ADD COLUMN "country" TEXT,
    ADD COLUMN "linkedinUrl" TEXT,
    ADD COLUMN "twitterUrl" TEXT,
    ADD COLUMN "facebookUrl" TEXT;
