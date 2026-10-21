-- Preserve invoice template version history at the database boundary.
CREATE FUNCTION "reject_invoice_template_version_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'InvoiceTemplateVersion records are immutable; create a new version instead.'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "InvoiceTemplateVersion_immutable"
BEFORE UPDATE OR DELETE ON "InvoiceTemplateVersion"
FOR EACH ROW
EXECUTE FUNCTION "reject_invoice_template_version_mutation"();
