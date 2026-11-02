CREATE TYPE "RecurringInvoiceFrequency" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "RecurringInvoiceRunStatus" AS ENUM ('GENERATED', 'FAILED');

CREATE TABLE "RecurringInvoicePlan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "projectTitle" TEXT,
    "currencyCode" VARCHAR(3) NOT NULL,
    "frequency" "RecurringInvoiceFrequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "nextRunDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dueInDays" INTEGER,
    "discountLabel" TEXT,
    "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringInvoicePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringInvoiceItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "serviceId" UUID,
    "description" TEXT NOT NULL,
    "billingMode" "InvoiceItemBillingMode" NOT NULL DEFAULT 'QUANTITY',
    "quantity" DECIMAL(19,4) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringInvoiceItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringInvoiceRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "scheduledFor" DATE NOT NULL,
    "generatedInvoiceId" UUID,
    "status" "RecurringInvoiceRunStatus" NOT NULL,
    "failureCode" TEXT,
    "safeFailureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "RecurringInvoiceRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecurringInvoicePlan_organizationId_id_key" ON "RecurringInvoicePlan"("organizationId", "id");
CREATE INDEX "RecurringInvoicePlan_organizationId_isActive_nextRunDate_idx" ON "RecurringInvoicePlan"("organizationId", "isActive", "nextRunDate");
CREATE INDEX "RecurringInvoicePlan_organizationId_name_idx" ON "RecurringInvoicePlan"("organizationId", "name");
CREATE INDEX "RecurringInvoiceItem_organizationId_planId_position_idx" ON "RecurringInvoiceItem"("organizationId", "planId", "position");
CREATE INDEX "RecurringInvoiceItem_organizationId_serviceId_idx" ON "RecurringInvoiceItem"("organizationId", "serviceId");
CREATE UNIQUE INDEX "RecurringInvoiceRun_planId_scheduledFor_key" ON "RecurringInvoiceRun"("planId", "scheduledFor");
CREATE UNIQUE INDEX "RecurringInvoiceRun_generatedInvoiceId_key" ON "RecurringInvoiceRun"("generatedInvoiceId");
CREATE INDEX "RecurringInvoiceRun_organizationId_planId_scheduledFor_idx" ON "RecurringInvoiceRun"("organizationId", "planId", "scheduledFor");

ALTER TABLE "RecurringInvoicePlan" ADD CONSTRAINT "RecurringInvoicePlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoicePlan" ADD CONSTRAINT "RecurringInvoicePlan_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "Client"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoiceItem" ADD CONSTRAINT "RecurringInvoiceItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoiceItem" ADD CONSTRAINT "RecurringInvoiceItem_organizationId_planId_fkey" FOREIGN KEY ("organizationId", "planId") REFERENCES "RecurringInvoicePlan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoiceItem" ADD CONSTRAINT "RecurringInvoiceItem_organizationId_serviceId_fkey" FOREIGN KEY ("organizationId", "serviceId") REFERENCES "Service"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_organizationId_planId_fkey" FOREIGN KEY ("organizationId", "planId") REFERENCES "RecurringInvoicePlan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_organizationId_generatedInvoiceId_fkey" FOREIGN KEY ("organizationId", "generatedInvoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
