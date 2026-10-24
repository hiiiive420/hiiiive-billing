ALTER TABLE "InvoiceEmailAttempt"
ADD CONSTRAINT "InvoiceEmailAttempt_terminal_state_check"
CHECK (
    ("status" = 'PENDING' AND "sentAt" IS NULL AND "failedAt" IS NULL AND "failureCode" IS NULL AND "safeFailureMessage" IS NULL AND "providerMessageId" IS NULL)
    OR ("status" = 'SENT' AND "sentAt" IS NOT NULL AND "failedAt" IS NULL AND "failureCode" IS NULL AND "safeFailureMessage" IS NULL)
    OR ("status" = 'FAILED' AND "failedAt" IS NOT NULL AND "sentAt" IS NULL AND "failureCode" IS NOT NULL AND "safeFailureMessage" IS NOT NULL)
);

CREATE FUNCTION "guard_invoice_email_attempt_history"() RETURNS trigger AS $$
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

    IF NEW."status" NOT IN ('SENT', 'FAILED') THEN
        RAISE EXCEPTION 'Invoice email attempts can only transition from PENDING to a terminal status';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceEmailAttempt_immutable_history"
BEFORE UPDATE OR DELETE ON "InvoiceEmailAttempt"
FOR EACH ROW EXECUTE FUNCTION "guard_invoice_email_attempt_history"();
