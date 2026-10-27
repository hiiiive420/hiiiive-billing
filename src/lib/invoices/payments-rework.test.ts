import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import { issueInvoice } from "./issue-invoice";
import { InvoicePaymentReadModelError, loadInvoicePaymentSummary } from "./invoice-payments";
import { PaymentRecordingError, recordPayment } from "./record-payment";
import { InvoiceReworkError, supersedeInvoice } from "./rework-invoice";

const prisma = getPrismaClient();
const decimal = (value: string) => new Prisma.Decimal(value);
const paidAt = new Date("2026-10-21T10:00:00.000Z");

type Fixture = { organizationId: string; clientId: string };

const issuanceTemplateConfig = {
  companyName: "Hiiiive",
  headingFontName: "DejaVu Serif",
  bodyFontName: "DM Sans",
  primaryColor: "#255B83",
};

after(async () => {
  await prisma.$disconnect();
});

describe("recordPayment (PostgreSQL integration)", () => {
  it("sets PARTIALLY_PAID after the first partial payment", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      const payment = await recordPayment(organizationId, invoiceId, paymentInput("25"));
      const invoice = await getInvoice(organizationId, invoiceId);

      assert.equal(payment.amount.toString(), "25");
      assert.equal(invoice.paymentStatus, "PARTIALLY_PAID");
    });
  });

  it("sets PAID after multiple payments reach the invoice total", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      await recordPayment(organizationId, invoiceId, paymentInput("30"));
      await recordPayment(organizationId, invoiceId, paymentInput("70"));
      const invoice = await getInvoice(organizationId, invoiceId);
      const payments = await prisma.payment.findMany({ where: { organizationId, invoiceId } });

      assert.equal(payments.length, 2);
      assert.equal(invoice.paymentStatus, "PAID");
    });
  });

  it("sets PAID for an exact full payment", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      await recordPayment(organizationId, invoiceId, paymentInput("100"));
      assert.equal((await getInvoice(organizationId, invoiceId)).paymentStatus, "PAID");
    });
  });

  it("keeps an overpayment recorded without changing grandTotal", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      await recordPayment(organizationId, invoiceId, paymentInput("125"));
      const invoice = await getInvoice(organizationId, invoiceId);
      const totalPaid = (await prisma.payment.aggregate({
        where: { organizationId, invoiceId },
        _sum: { amount: true },
      }))._sum.amount;

      assert.equal(invoice.paymentStatus, "PAID");
      assert.equal(invoice.grandTotal.toString(), "100");
      assert.equal(totalPaid?.toString(), "125");
    });
  });

  it("rejects zero and negative payments without inserting records", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      await assert.rejects(recordPayment(organizationId, invoiceId, paymentInput("0")), PaymentRecordingError);
      await assert.rejects(recordPayment(organizationId, invoiceId, paymentInput("-1")), PaymentRecordingError);
      assert.equal(await prisma.payment.count({ where: { organizationId, invoiceId } }), 0);
      assert.equal((await getInvoice(organizationId, invoiceId)).paymentStatus, "UNPAID");
    });
  });

  it("rejects a payment to a draft invoice", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createDraftInvoice(organizationId, clientId, "100");
      await assert.rejects(recordPayment(organizationId, invoiceId, paymentInput("10")), PaymentRecordingError);
      assert.equal(await prisma.payment.count({ where: { organizationId, invoiceId } }), 0);
    });
  });

  it("rejects payments to VOID, SUPERSEDED, and WRITTEN_OFF invoices", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      for (const lifecycleStatus of ["VOID", "SUPERSEDED", "WRITTEN_OFF"] as const) {
        const invoiceId = await createIssuedInvoice(organizationId, clientId, "100");
        await prisma.invoice.update({ where: { id: invoiceId }, data: { lifecycleStatus } });
        await assert.rejects(
          recordPayment(organizationId, invoiceId, paymentInput("10")),
          PaymentRecordingError,
        );
        assert.equal(await prisma.payment.count({ where: { organizationId, invoiceId } }), 0);
      }
    });
  });

  it("enforces tenant scope when recording payments", async () => {
    await withOrganization(async (first) => {
      await withOrganization(async (second) => {
        const invoiceId = await createIssuedInvoice(second.organizationId, second.clientId, "100");
        await assert.rejects(
          recordPayment(first.organizationId, invoiceId, paymentInput("10")),
          /not found in this organization/,
        );
        assert.equal(await prisma.payment.count({ where: { organizationId: second.organizationId, invoiceId } }), 0);
        assert.equal((await getInvoice(second.organizationId, invoiceId)).paymentStatus, "UNPAID");
      }, "secondary");
    });
  });

  it("serializes concurrent payments and derives the final status from both", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      await Promise.all([
        recordPayment(organizationId, invoiceId, paymentInput("60")),
        recordPayment(organizationId, invoiceId, paymentInput("40")),
      ]);
      const invoice = await getInvoice(organizationId, invoiceId);
      const payments = await prisma.payment.findMany({ where: { organizationId, invoiceId } });
      const total = payments.reduce((sum, payment) => sum.plus(payment.amount), decimal("0"));

      assert.equal(payments.length, 2);
      assert.equal(total.toString(), "100");
      assert.equal(invoice.paymentStatus, "PAID");
    });
  });
});

describe("invoice payment read model (PostgreSQL integration)", () => {
  it("reconciles zero, partial, full, ordered history and overpayment using frozen invoice values", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createDraftInvoice(organizationId, clientId, "100");
      await prisma.invoice.update({ where: { id: invoiceId }, data: { currencyCode: "USD" } });
      await issueInvoice(organizationId, invoiceId);
      await prisma.client.update({ where: { id: clientId }, data: { name: "Renamed Current Client" } });

      let summary = await loadInvoicePaymentSummary(organizationId, invoiceId);
      assert.equal(summary.currencyCode, "USD");
      assert.equal(summary.clientName, "Payments Test Client");
      assert.equal(summary.grandTotal, "100");
      assert.equal(summary.totalPaid, "0");
      assert.equal(summary.balanceDue, "100");
      assert.equal(summary.paymentStatus, "UNPAID");
      assert.equal(summary.payments.length, 0);

      await recordPayment(organizationId, invoiceId, { ...paymentInput("20"), paidAt: new Date("2026-10-20T10:00:00.000Z") });
      await recordPayment(organizationId, invoiceId, { ...paymentInput("35"), paidAt: new Date("2026-10-21T10:00:00.000Z") });
      summary = await loadInvoicePaymentSummary(organizationId, invoiceId);
      assert.equal(summary.totalPaid, "55");
      assert.equal(summary.balanceDue, "45");
      assert.equal(summary.paymentStatus, "PARTIALLY_PAID");
      assert.equal(summary.payments[0].amount, "35");
      assert.equal(summary.payments[1].amount, "20");

      await recordPayment(organizationId, invoiceId, paymentInput("45"));
      summary = await loadInvoicePaymentSummary(organizationId, invoiceId);
      assert.equal(summary.totalPaid, "100");
      assert.equal(summary.balanceDue, "0");
      assert.equal(summary.paymentStatus, "PAID");
      await recordPayment(organizationId, invoiceId, paymentInput("7.25"));
      summary = await loadInvoicePaymentSummary(organizationId, invoiceId);
      assert.equal(summary.totalPaid, "107.25");
      assert.equal(summary.balanceDue, "0");
      assert.equal(summary.overpaidAmount, "7.25");
      assert.equal(summary.paymentStatus, "PAID");
      assert.equal((await getInvoice(organizationId, invoiceId)).grandTotal.toString(), "100");
    });
  });

  it("does not expose foreign invoices and rejects persisted payment-status mismatches", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const invoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      await withOrganization(async (foreign) => {
        await assert.rejects(loadInvoicePaymentSummary(organizationId, await createIssuedInvoice(foreign.organizationId, foreign.clientId, "100")), InvoicePaymentReadModelError);
      }, "read-model-foreign");
      await prisma.invoice.update({ where: { id: invoiceId }, data: { paymentStatus: "PAID" } });
      await assert.rejects(loadInvoicePaymentSummary(organizationId, invoiceId), /does not match/);
    });
  });
});

describe("supersedeInvoice (PostgreSQL integration)", () => {
  it("links one replacement, supersedes the source, and preserves the draft and reason", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const sourceInvoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      const targetInvoiceId = await createDraftInvoice(organizationId, clientId, "25");
      const relations = await supersedeInvoice({
        organizationId,
        sourceInvoiceId,
        replacementInvoiceIds: [targetInvoiceId],
        reason: "Corrected billing scope",
      });
      const source = await getInvoice(organizationId, sourceInvoiceId);
      const target = await getInvoice(organizationId, targetInvoiceId);

      assert.equal(relations.length, 1);
      assert.equal(relations[0].sourceInvoiceId, sourceInvoiceId);
      assert.equal(relations[0].targetInvoiceId, targetInvoiceId);
      assert.equal(relations[0].reason, "Corrected billing scope");
      assert.equal(relations[0].relationType, "REPLACED_BY");
      assert.equal(source.lifecycleStatus, "SUPERSEDED");
      assert.equal(target.lifecycleStatus, "DRAFT");
      assert.equal(target.invoiceNumber, null);
    });
  });

  it("links one source to three replacement drafts", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const sourceInvoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      const targetIds = await Promise.all([
        createDraftInvoice(organizationId, clientId, "25"),
        createDraftInvoice(organizationId, clientId, "25"),
        createDraftInvoice(organizationId, clientId, "50"),
      ]);
      const relations = await supersedeInvoice({
        organizationId,
        sourceInvoiceId,
        replacementInvoiceIds: targetIds,
        reason: "Split into three invoices",
      });
      const targets = await prisma.invoice.findMany({
        where: { organizationId, id: { in: targetIds } },
      });

      assert.equal(relations.length, 3);
      assert.equal(new Set(relations.map((relation) => relation.targetInvoiceId)).size, 3);
      assert.equal(targets.every((invoice) => invoice.lifecycleStatus === "DRAFT" && invoice.invoiceNumber === null), true);
      assert.equal((await getInvoice(organizationId, sourceInvoiceId)).lifecycleStatus, "SUPERSEDED");
    });
  });

  it("rejects a replacement draft already linked to another source", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const firstSourceId = await createIssuedInvoice(organizationId, clientId, "100");
      const secondSourceId = await createIssuedInvoice(organizationId, clientId, "100");
      const replacementId = await createDraftInvoice(organizationId, clientId, "100");
      await supersedeInvoice({
        organizationId,
        sourceInvoiceId: firstSourceId,
        replacementInvoiceIds: [replacementId],
        reason: "First replacement link",
      });

      await assert.rejects(
        supersedeInvoice({
          organizationId,
          sourceInvoiceId: secondSourceId,
          replacementInvoiceIds: [replacementId],
          reason: "Conflicting replacement link",
        }),
        /only be linked to one source/,
      );
      const relations = await prisma.invoiceRelation.findMany({
        where: { organizationId, targetInvoiceId: replacementId, relationType: "REPLACED_BY" },
      });

      assert.equal(relations.length, 1);
      assert.equal(relations[0].sourceInvoiceId, firstSourceId);
      assert.equal((await getInvoice(organizationId, secondSourceId)).lifecycleStatus, "ISSUED");
    });
  });

  it("allows only one concurrent source to claim the same replacement draft", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const firstSourceId = await createIssuedInvoice(organizationId, clientId, "100");
      const secondSourceId = await createIssuedInvoice(organizationId, clientId, "100");
      const replacementId = await createDraftInvoice(organizationId, clientId, "100");
      const results = await Promise.allSettled([
        supersedeInvoice({
          organizationId,
          sourceInvoiceId: firstSourceId,
          replacementInvoiceIds: [replacementId],
          reason: "Concurrent source one",
        }),
        supersedeInvoice({
          organizationId,
          sourceInvoiceId: secondSourceId,
          replacementInvoiceIds: [replacementId],
          reason: "Concurrent source two",
        }),
      ]);
      const relations = await prisma.invoiceRelation.findMany({
        where: { organizationId, targetInvoiceId: replacementId, relationType: "REPLACED_BY" },
      });

      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      assert.equal(relations.length, 1);
      const firstSource = await getInvoice(organizationId, firstSourceId);
      const secondSource = await getInvoice(organizationId, secondSourceId);
      const sourceStatuses = [firstSource.lifecycleStatus, secondSource.lifecycleStatus];
      assert.equal(sourceStatuses.filter((status) => status === "SUPERSEDED").length, 1);
      assert.equal(sourceStatuses.filter((status) => status === "ISSUED").length, 1);
      assert.equal(
        [firstSource, secondSource].find((source) => source.lifecycleStatus === "ISSUED")?.id === relations[0].sourceInvoiceId,
        false,
      );
    });
  });

  it("rejects a cross-tenant replacement and leaves the source unchanged", async () => {
    await withOrganization(async (sourceOrg) => {
      await withOrganization(async (otherOrg) => {
        const sourceInvoiceId = await createIssuedInvoice(sourceOrg.organizationId, sourceOrg.clientId, "100");
        const targetInvoiceId = await createDraftInvoice(otherOrg.organizationId, otherOrg.clientId, "25");

        await assert.rejects(
          supersedeInvoice({
            organizationId: sourceOrg.organizationId,
            sourceInvoiceId,
            replacementInvoiceIds: [targetInvoiceId],
            reason: "Wrong tenant",
          }),
          InvoiceReworkError,
        );
        assert.equal((await getInvoice(sourceOrg.organizationId, sourceInvoiceId)).lifecycleStatus, "ISSUED");
        assert.equal(await prisma.invoiceRelation.count({ where: { organizationId: sourceOrg.organizationId } }), 0);
      }, "secondary");
    });
  });

  it("rejects duplicate replacement IDs and source self-replacement", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const sourceInvoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      const targetInvoiceId = await createDraftInvoice(organizationId, clientId, "25");
      const args = { organizationId, sourceInvoiceId, reason: "Invalid relationship" };

      await assert.rejects(
        supersedeInvoice({ ...args, replacementInvoiceIds: [targetInvoiceId, targetInvoiceId] }),
        InvoiceReworkError,
      );
      await assert.rejects(
        supersedeInvoice({ ...args, replacementInvoiceIds: [sourceInvoiceId] }),
        InvoiceReworkError,
      );
      assert.equal((await getInvoice(organizationId, sourceInvoiceId)).lifecycleStatus, "ISSUED");
      assert.equal(await prisma.invoiceRelation.count({ where: { organizationId } }), 0);
    });
  });

  it("rejects a source that is already superseded", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const sourceInvoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      const targetInvoiceId = await createDraftInvoice(organizationId, clientId, "25");
      await prisma.invoice.update({ where: { id: sourceInvoiceId }, data: { lifecycleStatus: "SUPERSEDED" } });

      await assert.rejects(
        supersedeInvoice({
          organizationId,
          sourceInvoiceId,
          replacementInvoiceIds: [targetInvoiceId],
          reason: "Already superseded",
        }),
        InvoiceReworkError,
      );
      assert.equal(await prisma.invoiceRelation.count({ where: { organizationId } }), 0);
    });
  });

  it("rejects an already linked replacement without changing source status or history", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const sourceInvoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      const targetInvoiceId = await createDraftInvoice(organizationId, clientId, "25");
      await prisma.invoiceRelation.create({
        data: {
          organizationId,
          sourceInvoiceId,
          targetInvoiceId,
          relationType: "REPLACED_BY",
          reason: "Existing historical relation",
        },
      });

      await assert.rejects(
        supersedeInvoice({
          organizationId,
          sourceInvoiceId,
          replacementInvoiceIds: [targetInvoiceId],
          reason: "This target is already linked",
        }),
        InvoiceReworkError,
      );
      assert.equal((await getInvoice(organizationId, sourceInvoiceId)).lifecycleStatus, "ISSUED");
      assert.equal(await prisma.invoiceRelation.count({ where: { organizationId } }), 1);
    });
  });

  it("preserves source payments without moving them to replacement drafts", async () => {
    await withOrganization(async ({ organizationId, clientId }) => {
      const sourceInvoiceId = await createIssuedInvoice(organizationId, clientId, "100");
      await recordPayment(organizationId, sourceInvoiceId, paymentInput("30"));
      const targetInvoiceId = await createDraftInvoice(organizationId, clientId, "70");

      await supersedeInvoice({
        organizationId,
        sourceInvoiceId,
        replacementInvoiceIds: [targetInvoiceId],
        reason: "Reissue with payment retained for accounting review",
      });

      const sourcePayments = await prisma.payment.findMany({ where: { organizationId, invoiceId: sourceInvoiceId } });
      const replacementPayments = await prisma.payment.findMany({ where: { organizationId, invoiceId: targetInvoiceId } });
      const source = await getInvoice(organizationId, sourceInvoiceId);
      assert.equal(source.lifecycleStatus, "SUPERSEDED");
      assert.equal(source.paymentStatus, "PARTIALLY_PAID");
      assert.equal(sourcePayments.length, 1);
      assert.equal(sourcePayments[0].amount.toString(), "30");
      assert.equal(replacementPayments.length, 0);
    });
  });
});

describe("InvoiceTemplateVersion immutability (PostgreSQL integration)", () => {
  it("allows creation and a new version while rejecting updates and deletion", async () => {
    const rollbackMarker = "rollback template immutability fixture";
    try {
      await prisma.$transaction(async (tx) => {
        const organizationId = randomUUID();
        const organization = await tx.organization.create({
          data: { id: organizationId, name: "Template Test", slug: `template-${organizationId}` },
        });
        const template = await tx.invoiceTemplate.create({
          data: { organizationId: organization.id, name: "Hiiiive", key: "hiiiive" },
        });
        const version1 = await tx.invoiceTemplateVersion.create({
          data: {
            organizationId: organization.id,
            templateId: template.id,
            version: 1,
            rendererKey: "hiiiive-default",
            config: { logo: "hiiiive-mark", accentColor: "#126b45" },
          },
        });
        const expectRejectedMutation = async (statement: () => Promise<unknown>) => {
          await tx.$executeRaw`SAVEPOINT template_version_mutation`;
          try {
            await statement();
            assert.fail("Expected immutable version mutation to fail");
          } catch (error) {
            assert.match(String(error), /immutable/);
          } finally {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT template_version_mutation`;
            await tx.$executeRaw`RELEASE SAVEPOINT template_version_mutation`;
          }
        };

        await expectRejectedMutation(() => tx.invoiceTemplateVersion.update({
          where: { id: version1.id },
          data: { config: { accentColor: "#000000" } },
        }));
        await expectRejectedMutation(() => tx.invoiceTemplateVersion.update({
          where: { id: version1.id },
          data: { rendererKey: "other-renderer" },
        }));
        await expectRejectedMutation(() => tx.invoiceTemplateVersion.update({
          where: { id: version1.id },
          data: { version: 9 },
        }));
        await expectRejectedMutation(() => tx.invoiceTemplateVersion.delete({ where: { id: version1.id } }));

        const version2 = await tx.invoiceTemplateVersion.create({
          data: {
            organizationId: organization.id,
            templateId: template.id,
            version: 2,
            rendererKey: "hiiiive-default",
            config: { logo: "updated-hiiiive-mark", accentColor: "#123456" },
          },
        });
        const unchangedVersion1 = await tx.invoiceTemplateVersion.findUniqueOrThrow({ where: { id: version1.id } });

        assert.equal(version2.version, 2);
        assert.equal(unchangedVersion1.version, 1);
        assert.equal(unchangedVersion1.rendererKey, "hiiiive-default");
        assert.deepEqual(unchangedVersion1.config, version1.config);
        throw new Error(rollbackMarker);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== rollbackMarker) throw error;
    }
  });
});
function paymentInput(amount: string) {
  return { amount, paidAt, method: "BANK_TRANSFER" as const };
}

async function withOrganization(
  run: (fixture: Fixture) => Promise<void>,
  tenant = "primary",
): Promise<void> {
  const organizationId = await ensurePaymentOrganization(tenant);
  const template = await ensurePaymentTemplate(organizationId);
  await cleanupPaymentFixture(organizationId);
  try {
    await setPaymentDefaultTemplate(organizationId, template.id);
    const client = await prisma.client.create({
      data: { organizationId, name: "Payments Test Client" },
    });
    await run({ organizationId, clientId: client.id });
  } finally {
    await cleanupPaymentFixture(organizationId);
    await setPaymentDefaultTemplate(organizationId, template.id);
  }
}

async function ensurePaymentOrganization(tenant: string): Promise<string> {
  const slug = `payments-integration-${tenant}`;
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) return existing.id;
  const created = await prisma.organization.create({ data: { name: "Payments Integration", slug } });
  return created.id;
}

async function ensurePaymentTemplate(organizationId: string) {
  const template = await prisma.invoiceTemplate.upsert({
    where: { organizationId_key: { organizationId, key: "hiiiive-default-test" } },
    create: {
      organizationId,
      key: "hiiiive-default-test",
      name: "Hiiiive Test",
      active: true,
    },
    update: { active: true },
  });
  const existingVersion = await prisma.invoiceTemplateVersion.findUnique({
    where: { organizationId_templateId_version: { organizationId, templateId: template.id, version: 1 } },
  });
  if (!existingVersion) {
    await prisma.invoiceTemplateVersion.create({
      data: {
        organizationId,
        templateId: template.id,
        version: 1,
        rendererKey: "hiiiive-default",
        config: issuanceTemplateConfig,
      },
    });
  }
  return template;
}

async function setPaymentDefaultTemplate(organizationId: string, templateId: string): Promise<void> {
  await prisma.invoiceTemplate.updateMany({ where: { organizationId }, data: { isDefault: false } });
  await prisma.invoiceTemplate.update({ where: { id: templateId }, data: { active: true, isDefault: true } });
}

async function cleanupPaymentFixture(organizationId: string): Promise<void> {
  await prisma.invoiceRelation.deleteMany({ where: { organizationId } });
  await prisma.payment.deleteMany({ where: { organizationId } });
  await prisma.invoiceItem.deleteMany({ where: { organizationId } });
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.invoiceSequence.deleteMany({ where: { organizationId } });
  await prisma.client.deleteMany({ where: { organizationId } });
}

async function createDraftInvoice(
  organizationId: string,
  clientId: string,
  total: string,
): Promise<string> {
  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      clientId,
      invoiceDate: new Date("2026-10-21T00:00:00.000Z"),
    },
  });
  await prisma.invoiceItem.create({
    data: {
      organizationId,
      invoiceId: invoice.id,
      description: "Test line",
      quantity: decimal("1"),
      unitPrice: decimal(total),
      lineTotal: decimal("0"),
      position: 0,
    },
  });
  return invoice.id;
}

async function createIssuedInvoice(
  organizationId: string,
  clientId: string,
  total: string,
): Promise<string> {
  const invoiceId = await createDraftInvoice(organizationId, clientId, total);
  await issueInvoice(organizationId, invoiceId);
  return invoiceId;
}

async function getInvoice(organizationId: string, invoiceId: string) {
  return prisma.invoice.findFirstOrThrow({ where: { organizationId, id: invoiceId } });
}


