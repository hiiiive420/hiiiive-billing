-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "templateVersionId" UUID;

-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceTemplateVersion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rendererKey" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceTemplate_organizationId_isDefault_idx" ON "InvoiceTemplate"("organizationId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTemplate_organizationId_id_key" ON "InvoiceTemplate"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTemplate_organizationId_key_key" ON "InvoiceTemplate"("organizationId", "key");

-- CreateIndex
CREATE INDEX "InvoiceTemplateVersion_organizationId_templateId_idx" ON "InvoiceTemplateVersion"("organizationId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTemplateVersion_organizationId_id_key" ON "InvoiceTemplateVersion"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTemplateVersion_organizationId_templateId_version_key" ON "InvoiceTemplateVersion"("organizationId", "templateId", "version");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_templateVersionId_idx" ON "Invoice"("organizationId", "templateVersionId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_templateVersionId_fkey" FOREIGN KEY ("organizationId", "templateVersionId") REFERENCES "InvoiceTemplateVersion"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplate" ADD CONSTRAINT "InvoiceTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplateVersion" ADD CONSTRAINT "InvoiceTemplateVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplateVersion" ADD CONSTRAINT "InvoiceTemplateVersion_organizationId_templateId_fkey" FOREIGN KEY ("organizationId", "templateId") REFERENCES "InvoiceTemplate"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
