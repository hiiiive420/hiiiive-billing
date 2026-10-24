ALTER TYPE "InvoiceEmailAttemptStatus" ADD VALUE 'PARTIALLY_SENT';

ALTER TABLE "InvoiceEmailAttempt"
ADD COLUMN "acceptedRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "rejectedRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "InvoiceEmailAttempt"
DROP CONSTRAINT "InvoiceEmailAttempt_terminal_state_check";

ALTER TABLE "InvoiceEmailAttempt"
ADD CONSTRAINT "InvoiceEmailAttempt_terminal_state_check"
CHECK (
    ("status" = 'PENDING' AND "sentAt" IS NULL AND "failedAt" IS NULL AND "failureCode" IS NULL AND "safeFailureMessage" IS NULL AND "providerMessageId" IS NULL AND cardinality("acceptedRecipients") = 0 AND cardinality("rejectedRecipients") = 0)
    OR ("status" = 'SENT' AND "sentAt" IS NOT NULL AND "failedAt" IS NULL AND "failureCode" IS NULL AND "safeFailureMessage" IS NULL AND cardinality("rejectedRecipients") = 0)
    OR ("status" = 'PARTIALLY_SENT' AND "sentAt" IS NOT NULL AND "failedAt" IS NOT NULL AND "failureCode" IS NOT NULL AND "safeFailureMessage" IS NOT NULL AND cardinality("acceptedRecipients") > 0 AND cardinality("rejectedRecipients") > 0)
    OR ("status" = 'FAILED' AND "failedAt" IS NOT NULL AND "sentAt" IS NULL AND "failureCode" IS NOT NULL AND "safeFailureMessage" IS NOT NULL AND cardinality("acceptedRecipients") = 0)
);

CREATE OR REPLACE FUNCTION "guard_invoice_email_attempt_history"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Invoice email attempts are immutable audit records';
    END IF;

    IF OLD."status" <> 'PENDING' THEN
        RAISE EXCEPTION 'Terminal invoice email attempts are immutable';
    END IF;

    IF ROW(
        NEW."id", NEW."organizationId", NEW."invoiceId", NEW."requestedByUserId",
        NEW."requestedByEmailSnapshot", NEW."fromEmail", NEW."fromName",
        NEW."toRecipients", NEW."ccRecipients", NEW."bccRecipients",
        NEW."subject", NEW."bodyText", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
        OLD."id", OLD."organizationId", OLD."invoiceId", OLD."requestedByUserId",
        OLD."requestedByEmailSnapshot", OLD."fromEmail", OLD."fromName",
        OLD."toRecipients", OLD."ccRecipients", OLD."bccRecipients",
        OLD."subject", OLD."bodyText", OLD."createdAt"
    ) THEN
        RAISE EXCEPTION 'Invoice email attempt snapshots are immutable';
    END IF;

    IF NEW."status" NOT IN ('SENT', 'PARTIALLY_SENT', 'FAILED') THEN
        RAISE EXCEPTION 'Invoice email attempts can only transition from PENDING to a terminal status';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
