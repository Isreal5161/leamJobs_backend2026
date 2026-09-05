CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "seekerId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "jobId" TEXT,
    "applicationId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clientMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_applicationId_key" ON "Conversation"("applicationId");
CREATE UNIQUE INDEX "Message_senderId_clientMessageId_key" ON "Message"("senderId", "clientMessageId");
CREATE INDEX "Conversation_seekerId_lastMessageAt_idx" ON "Conversation"("seekerId", "lastMessageAt");
CREATE INDEX "Conversation_employerId_lastMessageAt_idx" ON "Conversation"("employerId", "lastMessageAt");
CREATE INDEX "Conversation_jobId_lastMessageAt_idx" ON "Conversation"("jobId", "lastMessageAt");
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");
CREATE INDEX "Message_conversationId_readAt_idx" ON "Message"("conversationId", "readAt");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_seekerId_fkey" FOREIGN KEY ("seekerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;