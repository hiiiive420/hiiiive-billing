-- CreateEnum
CREATE TYPE "InvoiceEmailAttemptStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "InvoiceEmailAttempt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "requestedByEmailSnapshot" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "toRecipients" TEXT[],
    "ccRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bccRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" "InvoiceEmailAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "failureCode" TEXT,
    "safeFailureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "InvoiceEmailAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceEmailAttempt_organizationId_invoiceId_createdAt_idx" ON "InvoiceEmailAttempt"("organizationId", "invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceEmailAttempt_organizationId_requestedByUserId_create_idx" ON "InvoiceEmailAttempt"("organizationId", "requestedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceEmailAttempt" ADD CONSTRAINT "InvoiceEmailAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEmailAttempt" ADD CONSTRAINT "InvoiceEmailAttempt_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEmailAttempt" ADD CONSTRAINT "InvoiceEmailAttempt_organizationId_requestedByUserId_fkey" FOREIGN KEY ("organizationId", "requestedByUserId") REFERENCES "OrganizationMembership"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
