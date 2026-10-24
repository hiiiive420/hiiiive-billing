import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getInvoiceEmailSender, getSmtpConfiguration, InvoiceEmailConfigurationError } from "./smtp";

describe("invoice SMTP configuration", () => {
  const base = {
    SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "false",
    SMTP_USER: "user", SMTP_PASSWORD: "secret", INVOICE_FROM_EMAIL: "billing@hiiiive.lk", INVOICE_FROM_NAME: "Hiiiive",
  };

  it("requires explicit secure mode and returns the configured port and credentials", () => {
    assert.deepEqual(getSmtpConfiguration(base), { host: "smtp.example.test", port: 587, secure: false, user: "user", password: "secret" });
    assert.equal(getSmtpConfiguration({ ...base, SMTP_PORT: "465", SMTP_SECURE: "true" }).secure, true);
    assert.throws(() => getSmtpConfiguration({ ...base, SMTP_SECURE: "" }), InvoiceEmailConfigurationError);
    assert.throws(() => getSmtpConfiguration({ ...base, SMTP_PORT: "0" }), InvoiceEmailConfigurationError);
    assert.throws(() => getSmtpConfiguration({ ...base, SMTP_HOST: "bad host" }), InvoiceEmailConfigurationError);
    assert.throws(() => getSmtpConfiguration({ ...base, SMTP_PASSWORD: "" }), InvoiceEmailConfigurationError);
  });

  it("requires a valid configured sender and rejects header injection", () => {
    assert.deepEqual(getInvoiceEmailSender(base), { email: "billing@hiiiive.lk", name: "Hiiiive" });
    assert.throws(() => getInvoiceEmailSender({ ...base, INVOICE_FROM_EMAIL: "" }), InvoiceEmailConfigurationError);
    assert.throws(() => getInvoiceEmailSender({ ...base, INVOICE_FROM_NAME: "Hiiiive\r\nBcc: attacker@example.test" }), InvoiceEmailConfigurationError);
  });

});
