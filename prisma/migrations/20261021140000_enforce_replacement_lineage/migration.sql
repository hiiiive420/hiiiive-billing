-- DropIndex
DROP INDEX "InvoiceRelation_organizationId_sourceInvoiceId_targetInvoic_key";

-- DropIndex
DROP INDEX "InvoiceRelation_organizationId_targetInvoiceId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRelation_organizationId_targetInvoiceId_relationType_key" ON "InvoiceRelation"("organizationId", "targetInvoiceId", "relationType");
