-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceRelationType" AS ENUM ('REPLACED_BY');

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceRelation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceInvoiceId" UUID NOT NULL,
    "targetInvoiceId" UUID NOT NULL,
    "relationType" "InvoiceRelationType" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_organizationId_invoiceId_paidAt_idx" ON "Payment"("organizationId", "invoiceId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_organizationId_paidAt_idx" ON "Payment"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "InvoiceRelation_organizationId_sourceInvoiceId_idx" ON "InvoiceRelation"("organizationId", "sourceInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceRelation_organizationId_targetInvoiceId_idx" ON "InvoiceRelation"("organizationId", "targetInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRelation_organizationId_sourceInvoiceId_targetInvoic_key" ON "InvoiceRelation"("organizationId", "sourceInvoiceId", "targetInvoiceId", "relationType");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRelation" ADD CONSTRAINT "InvoiceRelation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRelation" ADD CONSTRAINT "InvoiceRelation_organizationId_sourceInvoiceId_fkey" FOREIGN KEY ("organizationId", "sourceInvoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRelation" ADD CONSTRAINT "InvoiceRelation_organizationId_targetInvoiceId_fkey" FOREIGN KEY ("organizationId", "targetInvoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
