import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { OrganizationRole } from "@/generated/prisma/enums";
import { getPrismaClient } from "../prisma";
import { requireOrganizationBySlug } from "../auth/authorization";
import { createDraftInvoice } from "./draft-invoice";
import { issueInvoice } from "./issue-invoice";
import { InvoiceEmailError, invoiceEmailLifecycleAllowed, loadInvoiceEmailComposerData, sendIssuedInvoiceEmail } from "./invoice-email";
import type { OutgoingInvoiceEmail } from "../email/smtp";

const prisma = getPrismaClient();
const testConfig = { companyName: "Hiiiive", headingFontName: "DejaVu Serif", bodyFontName: "DM Sans", primaryColor: "#255B83" };
const env = {
  SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "false",
  SMTP_USER: "test-user", SMTP_PASSWORD: "test-password",
  INVOICE_FROM_EMAIL: "billing@hiiiive.lk", INVOICE_FROM_NAME: "Hiiiive",
};

after(async () => { await prisma.$disconnect(); });

describe("issued invoice email workflow (PostgreSQL integration; fake SMTP)", () => {
  it("uses the frozen client email, sends the official-PDF contract, and records immutable success without changing invoice state", async () => {
    const fixture = await createIssuedFixture();
    const beforeInvoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId: fixture.organizationId, id: fixture.invoiceId } });
    const beforeSequence = await prisma.invoiceSequence.findFirstOrThrow({ where: { organizationId: fixture.organizationId, key: "DEFAULT" } });
    const beforePayments = await prisma.payment.count({ where: { organizationId: fixture.organizationId, invoiceId: fixture.invoiceId } });
    let transportCalls = 0;
    let sentMessage: OutgoingInvoiceEmail | undefined;
    const result = await sendIssuedInvoiceEmail(fixture.organizationId, fixture.invoiceId, fixture.actor, {
      to: "Accountant@client.test, finance@client.test",
      cc: "manager@client.test",
      bcc: "audit@hiiiive.lk",
      subject: "Reviewed invoice I",
      bodyText: "Edited body",
    }, {
      env,
      now: () => new Date("2026-10-23T10:00:00.000Z"),
      pdfGenerator: async (organizationId, invoiceId) => {
        assert.equal(organizationId, fixture.organizationId);
        assert.equal(invoiceId, fixture.invoiceId);
        return { filename: `Invoice-${fixture.invoiceNumber}.pdf`, bytes: new Uint8Array([37, 80, 68, 70, 45]) };
      },
      transportFactory: () => ({ sendMail: async (message) => {
        transportCalls += 1;
        sentMessage = message;
        return { messageId: "smtp-test-id", accepted: [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])], rejected: [] };
      } }),
    });

    assert.equal(transportCalls, 1);
    assert.ok(sentMessage);
    assert.deepEqual(sentMessage.from, { name: "Hiiiive", address: "billing@hiiiive.lk" });
    assert.deepEqual(sentMessage.to, ["accountant@client.test", "finance@client.test"]);
    assert.deepEqual(sentMessage.cc, ["manager@client.test"]);
    assert.deepEqual(sentMessage.bcc, ["audit@hiiiive.lk"]);
    assert.equal(sentMessage.subject, "Reviewed invoice I");
    assert.equal(sentMessage.text, "Edited body");
    assert.equal(sentMessage.attachments[0]?.filename, `Invoice-${fixture.invoiceNumber}.pdf`);
    assert.equal(sentMessage.attachments[0]?.contentType, "application/pdf");
    assert.deepEqual([...sentMessage.attachments[0]!.content], [37, 80, 68, 70, 45]);
    assert.equal(sentMessage.to.join(" ").includes("audit@hiiiive.lk"), false);
    assert.equal(sentMessage.cc?.join(" ").includes("audit@hiiiive.lk"), false);
    assert.equal(sentMessage.text.includes("audit@hiiiive.lk"), false);
    assert.equal(result.providerMessageId, "smtp-test-id");

    const attempt = await prisma.invoiceEmailAttempt.findFirstOrThrow({ where: { id: result.attemptId } });
    assert.equal(attempt.status, "SENT");
    assert.equal(attempt.sentAt?.toISOString(), "2026-10-23T10:00:00.000Z");
    assert.equal(attempt.providerMessageId, "smtp-test-id");
    assert.deepEqual(attempt.toRecipients, ["accountant@client.test", "finance@client.test"]);
    assert.deepEqual(attempt.ccRecipients, ["manager@client.test"]);
    assert.deepEqual(attempt.bccRecipients, ["audit@hiiiive.lk"]);
    assert.deepEqual(attempt.acceptedRecipients, ["accountant@client.test", "finance@client.test", "manager@client.test", "audit@hiiiive.lk"]);
    assert.deepEqual(attempt.rejectedRecipients, []);
    assert.equal(attempt.bodyText, "Edited body");
    await assert.rejects(prisma.invoiceEmailAttempt.update({ where: { id: attempt.id }, data: { subject: "rewritten" } }), /immutable/i);
    await assert.rejects(prisma.invoiceEmailAttempt.delete({ where: { id: attempt.id } }), /immutable/i);

    const afterInvoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId: fixture.organizationId, id: fixture.invoiceId } });
    const afterSequence = await prisma.invoiceSequence.findFirstOrThrow({ where: { organizationId: fixture.organizationId, key: "DEFAULT" } });
    assert.equal(afterInvoice.lifecycleStatus, "ISSUED");
    assert.equal(afterInvoice.paymentStatus, beforeInvoice.paymentStatus);
    assert.equal(afterInvoice.invoiceNumber, beforeInvoice.invoiceNumber);
    assert.equal(afterInvoice.grandTotal.toString(), beforeInvoice.grandTotal.toString());
    assert.equal(afterInvoice.issuedAt?.toISOString(), beforeInvoice.issuedAt?.toISOString());
    assert.deepEqual(afterSequence, beforeSequence);
    assert.equal(await prisma.payment.count({ where: { organizationId: fixture.organizationId, invoiceId: fixture.invoiceId } }), beforePayments);

    await prisma.client.update({ where: { id: fixture.clientId }, data: { email: "changed@client.test" } });
    const composer = await loadInvoiceEmailComposerData(fixture.organizationId, fixture.invoiceId);
    assert.equal(composer.invoice.suggestedTo, fixture.snapshotEmail);
    assert.equal(composer.recentAttempts[0]?.id, attempt.id);
    assert.equal("bccRecipients" in composer.recentAttempts[0]!, false);
  });

  it("stores the authenticated user's email, not their display name, in the attempt audit", async () => {
    const fixture = await createIssuedFixture();
    const previousDevEmail = process.env.DEV_AUTH_EMAIL;
    process.env.DEV_AUTH_EMAIL = "person@example.com";
    try {
      const workspace = await requireOrganizationBySlug("invoice-email-integration", "INVOICE_SEND");
      assert.equal(workspace.userLabel, "Krishna");
      assert.equal(workspace.userEmail, "person@example.com");
      const result = await sendIssuedInvoiceEmail(fixture.organizationId, fixture.invoiceId, {
        userId: workspace.userId,
        email: workspace.userEmail,
      }, { to: "recipient@example.com", subject: "Invoice", bodyText: "Please review." }, {
        env,
        pdfGenerator: async () => ({ filename: "Invoice-I.pdf", bytes: new Uint8Array([1]) }),
        transportFactory: () => ({ sendMail: async () => ({ messageId: "identity-id", accepted: ["recipient@example.com"], rejected: [] }) }),
      });
      const attempt = await prisma.invoiceEmailAttempt.findUniqueOrThrow({ where: { id: result.attemptId } });
      assert.equal(attempt.requestedByEmailSnapshot, "person@example.com");
      assert.notEqual(attempt.requestedByEmailSnapshot, "Krishna");
    } finally {
      if (previousDevEmail === undefined) delete process.env.DEV_AUTH_EMAIL;
      else process.env.DEV_AUTH_EMAIL = previousDevEmail;
    }
  });

  it("records SMTP failures safely and permits retry as a new attempt without touching invoice numbering", async () => {
    const fixture = await createIssuedFixture();
    const sequenceBefore = await prisma.invoiceSequence.findFirstOrThrow({ where: { organizationId: fixture.organizationId, key: "DEFAULT" } });
    const input = { to: "recipient@example.test", subject: "Invoice", bodyText: "Please review." };
    await assert.rejects(sendIssuedInvoiceEmail(fixture.organizationId, fixture.invoiceId, fixture.actor, input, {
      env,
      pdfGenerator: async () => ({ filename: "Invoice-I202610231.pdf", bytes: new Uint8Array([1]) }),
      transportFactory: () => ({ sendMail: async () => { throw new Error("secret smtp host and password"); } }),
    }), /couldn't send the invoice email/i);
    const failed = await prisma.invoiceEmailAttempt.findFirstOrThrow({ where: { organizationId: fixture.organizationId, invoiceId: fixture.invoiceId, status: "FAILED" } });
    assert.ok(failed.failedAt);
    assert.equal(failed.failureCode, "SMTP_SEND_FAILED");
    assert.doesNotMatch(failed.safeFailureMessage ?? "", /secret|password|smtp host/i);

    const success = await sendIssuedInvoiceEmail(fixture.organizationId, fixture.invoiceId, fixture.actor, input, {
      env,
      pdfGenerator: async () => ({ filename: "Invoice-I202610231.pdf", bytes: new Uint8Array([1]) }),
      transportFactory: () => ({ sendMail: async () => ({ messageId: "retry-id", accepted: ["recipient@example.test"], rejected: [] }) }),
    });
    assert.notEqual(success.attemptId, failed.id);
    assert.equal((await prisma.invoiceEmailAttempt.findUniqueOrThrow({ where: { id: success.attemptId } })).status, "SENT");
    assert.deepEqual(await prisma.invoiceSequence.findFirstOrThrow({ where: { organizationId: fixture.organizationId, key: "DEFAULT" } }), sequenceBefore);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId: fixture.organizationId, id: fixture.invoiceId } });
    assert.equal(invoice.lifecycleStatus, "ISSUED");
    assert.equal(invoice.invoiceNumber, fixture.invoiceNumber);
  });

  it("preserves rejected recipient results when SMTP accepts nobody", async () => {
    const fixture = await createIssuedFixture();
    await assert.rejects(sendIssuedInvoiceEmail(fixture.organizationId, fixture.invoiceId, fixture.actor, {
      to: "wrong@example.com", subject: "Invoice", bodyText: "Please review.",
    }, {
      env,
      pdfGenerator: async () => ({ filename: "Invoice-I.pdf", bytes: new Uint8Array([1]) }),
      transportFactory: () => ({ sendMail: async () => ({ accepted: [], rejected: ["wrong@example.com"] }) }),
    }), /couldn't send the invoice email/i);
    const failed = await prisma.invoiceEmailAttempt.findFirstOrThrow({
      where: { organizationId: fixture.organizationId, invoiceId: fixture.invoiceId, status: "FAILED" },
      orderBy: { createdAt: "desc" },
    });
    assert.deepEqual(failed.acceptedRecipients, []);
    assert.deepEqual(failed.rejectedRecipients, ["wrong@example.com"]);
  });

  it("records mixed SMTP delivery as terminal partial success with recipient snapshots and no invoice changes", async () => {
    const fixture = await createIssuedFixture();
    const beforeInvoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId: fixture.organizationId, id: fixture.invoiceId } });
    const beforeSequence = await prisma.invoiceSequence.findFirstOrThrow({ where: { organizationId: fixture.organizationId, key: "DEFAULT" } });
    const input = { to: "accepted@example.test, rejected@example.test", subject: "Invoice", bodyText: "Please review." };
    await assert.rejects(sendIssuedInvoiceEmail(fixture.organizationId, fixture.invoiceId, fixture.actor, input, {
      env,
      now: () => new Date("2026-10-24T10:00:00.000Z"),
      pdfGenerator: async () => ({ filename: "Invoice-I.pdf", bytes: new Uint8Array([1]) }),
      transportFactory: () => ({ sendMail: async () => ({ messageId: "partial-id", accepted: ["accepted@example.test"], rejected: ["rejected@example.test"] }) }),
    }), /delivered to some recipients.*review the delivery details before sending again/i);
    const partial = await prisma.invoiceEmailAttempt.findFirstOrThrow({ where: { organizationId: fixture.organizationId, invoiceId: fixture.invoiceId, status: "PARTIALLY_SENT" } });
    assert.equal(partial.sentAt?.toISOString(), "2026-10-24T10:00:00.000Z");
    assert.equal(partial.failedAt?.toISOString(), "2026-10-24T10:00:00.000Z");
    assert.equal(partial.providerMessageId, "partial-id");
    assert.deepEqual(partial.acceptedRecipients, ["accepted@example.test"]);
    assert.deepEqual(partial.rejectedRecipients, ["rejected@example.test"]);
    await assert.rejects(prisma.invoiceEmailAttempt.update({ where: { id: partial.id }, data: { subject: "rewritten" } }), /immutable/i);
    const afterInvoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId: fixture.organizationId, id: fixture.invoiceId } });
    assert.equal(afterInvoice.updatedAt.toISOString(), beforeInvoice.updatedAt.toISOString());
    assert.deepEqual(await prisma.invoiceSequence.findFirstOrThrow({ where: { organizationId: fixture.organizationId, key: "DEFAULT" } }), beforeSequence);

    const retry = await sendIssuedInvoiceEmail(fixture.organizationId, fixture.invoiceId, fixture.actor, input, {
      env,
      pdfGenerator: async () => ({ filename: "Invoice-I.pdf", bytes: new Uint8Array([1]) }),
      transportFactory: () => ({ sendMail: async () => ({ messageId: "retry-id", accepted: ["accepted@example.test", "rejected@example.test"], rejected: [] }) }),
    });
    assert.notEqual(retry.attemptId, partial.id);
    const composer = await loadInvoiceEmailComposerData(fixture.organizationId, fixture.invoiceId);
    assert.equal(composer.recentAttempts[0]?.status, "SENT");
    assert.equal("bccRecipients" in composer.recentAttempts[0]!, false);
    assert.equal(composer.recentAttempts.some((attempt) => attempt.status === "PARTIALLY_SENT"), true);
  });

  it("never calls SMTP for a draft or another organization and allows only ISSUED lifecycle states", async () => {
    const fixture = await createDraftFixture();
    let transportCalls = 0;
    await assert.rejects(sendIssuedInvoiceEmail(fixture.organizationId, fixture.invoiceId, fixture.actor, {
      to: "recipient@example.test", subject: "Invoice", bodyText: "Message",
    }, { env, transportFactory: () => ({ sendMail: async () => { transportCalls += 1; return {}; } }) }), InvoiceEmailError);
    await assert.rejects(sendIssuedInvoiceEmail(fixture.otherOrganizationId, fixture.invoiceId, fixture.actor, {
      to: "recipient@example.test", subject: "Invoice", bodyText: "Message",
    }, { env, transportFactory: () => ({ sendMail: async () => { transportCalls += 1; return {}; } }) }), InvoiceEmailError);
    assert.equal(transportCalls, 0);
    for (const status of ["DRAFT", "SUPERSEDED", "VOID", "WRITTEN_OFF"]) assert.equal(invoiceEmailLifecycleAllowed(status), false);
    assert.equal(invoiceEmailLifecycleAllowed("ISSUED"), true);
  });
});

async function createDraftFixture() {
  const base = await ensureBaseFixture();
  const client = await prisma.client.create({ data: { organizationId: base.organizationId, name: `Email Draft ${randomUUID()}`, email: "draft@client.test" } });
  const invoice = await createDraftInvoice(base.organizationId, { clientId: client.id, items: [{ description: "Email item", quantity: "1", unitPrice: "12" }] });
  return { ...base, clientId: client.id, invoiceId: invoice.id };
}

async function createIssuedFixture() {
  const fixture = await createDraftFixture();
  const issued = await issueInvoice(fixture.organizationId, fixture.invoiceId);
  return { ...fixture, invoiceNumber: issued.invoiceNumber!, snapshotEmail: issued.clientEmailSnapshot! };
}

async function ensureBaseFixture() {
  const slug = "invoice-email-integration";
  const organization = await prisma.organization.upsert({ where: { slug }, create: { slug, name: "Invoice Email Integration" }, update: {} });
  const template = await prisma.invoiceTemplate.upsert({
    where: { organizationId_key: { organizationId: organization.id, key: "invoice-email-template" } },
    create: { organizationId: organization.id, key: "invoice-email-template", name: "Invoice Email Test", active: true },
    update: { active: true },
  });
  const version = await prisma.invoiceTemplateVersion.findUnique({ where: { organizationId_templateId_version: { organizationId: organization.id, templateId: template.id, version: 1 } } });
  if (!version) await prisma.invoiceTemplateVersion.create({ data: { organizationId: organization.id, templateId: template.id, version: 1, rendererKey: "hiiiive-default", config: testConfig } });
  await prisma.invoiceTemplate.updateMany({ where: { organizationId: organization.id }, data: { isDefault: false } });
  await prisma.invoiceTemplate.update({ where: { id: template.id }, data: { active: true, isDefault: true } });

  const user = await prisma.user.upsert({ where: { email: "person@example.com" }, create: { email: "person@example.com", displayName: "Krishna" }, update: { active: true, displayName: "Krishna" } });
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    create: { organizationId: organization.id, userId: user.id, role: OrganizationRole.ADMIN, active: true },
    update: { role: OrganizationRole.ADMIN, active: true },
  });
  const other = await prisma.organization.upsert({ where: { slug: "invoice-email-foreign-integration" }, create: { slug: "invoice-email-foreign-integration", name: "Invoice Email Foreign" }, update: {} });
  return { organizationId: organization.id, otherOrganizationId: other.id, actor: { userId: user.id, email: user.email } };
}
