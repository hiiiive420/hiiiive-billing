-- CreateEnum
CREATE TYPE "InvoiceItemBillingMode" AS ENUM ('QUANTITY', 'FLAT_FEE');

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "billingMode" "InvoiceItemBillingMode" NOT NULL DEFAULT 'QUANTITY';
