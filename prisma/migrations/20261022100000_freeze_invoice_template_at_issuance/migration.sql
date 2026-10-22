-- An organization can have at most one template that is both active and default.
CREATE UNIQUE INDEX "InvoiceTemplate_one_active_default_per_org"
ON "InvoiceTemplate"("organizationId")
WHERE "active" = TRUE AND "isDefault" = TRUE;

-- Bind a template version as part of DRAFT -> ISSUED and never change it after issuance.
CREATE FUNCTION "protect_invoice_template_version_binding"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."lifecycleStatus" IN ('ISSUED', 'SUPERSEDED', 'VOID', 'WRITTEN_OFF')
       AND NEW."templateVersionId" IS DISTINCT FROM OLD."templateVersionId" THEN
        RAISE EXCEPTION 'Invoice template version is immutable after issuance.'
            USING ERRCODE = '55000';
    END IF;

    IF OLD."lifecycleStatus" = 'DRAFT'
       AND NEW."lifecycleStatus" = 'ISSUED'
       AND NEW."templateVersionId" IS NULL THEN
        RAISE EXCEPTION 'An issued invoice must retain its template version.'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Invoice_template_version_binding_immutable"
BEFORE UPDATE OF "templateVersionId", "lifecycleStatus" ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION "protect_invoice_template_version_binding"();
