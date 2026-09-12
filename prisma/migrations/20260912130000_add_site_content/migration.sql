CREATE TABLE "SiteContent" (
  "id" TEXT NOT NULL,
  "pageKey" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteContent_pageKey_key" ON "SiteContent"("pageKey");