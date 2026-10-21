import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import { InvoiceIssuanceError, issueInvoice } from "./issue-invoice";

const prisma = getPrismaClient();
const dbDecimal = (value: string) => new Prisma.Decimal(value);

type Fixture = {
  organizationId: string;
  clientId: string;
  invoiceId: string;
};

after(async () => {
  await prisma.$disconnect();
});

describe("issueInvoice (local PostgreSQL integration)", () => {
  it("issues a draft with recalculated totals, status, timestamp, and client snapshots", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      const result = await issueInvoice(organizationId, invoiceId);
      const item = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId } });

      assert.equal(result.lifecycleStatus, "ISSUED");
      assert.equal(result.paymentStatus, "UNPAID");
      assert.equal(result.invoiceNumber, "I202610091");
      assert.equal(result.issuedAt instanceof Date, true);
      assert.equal(result.invoiceDate?.toISOString(), "2026-10-09T00:00:00.000Z");
      assert.equal(result.subtotal.toString(), "20");
      assert.equal(result.discountAmount.toString(), "0");
      assert.equal(result.grandTotal.toString(), "20");
      assert.equal(item.lineTotal.toString(), "20");
      assert.equal(result.clientNameSnapshot, "Snapshot Client");
      assert.equal(result.clientBillingAddressSnapshot, "10 Test Road");
      assert.equal(result.clientEmailSnapshot, "client@example.test");
      assert.equal(result.clientPhoneSnapshot, "+94112223344");
    });
  });

  it("uses the Asia/Colombo calendar date when invoiceDate is absent", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { invoiceDate: null } });
      const result = await issueInvoice(organizationId, invoiceId);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Colombo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(result.issuedAt!);
      const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
      const expectedDate = `${values.year}-${values.month}-${values.day}T00:00:00.000Z`;

      assert.equal(result.invoiceDate?.toISOString(), expectedDate);
      assert.equal(result.invoiceNumber, `I${values.year}${values.month}${values.day}1`);
    });
  });

  it("recalculates line totals, subtotal, and grand total instead of trusting stored totals", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoiceItem.updateMany({ where: { invoiceId }, data: { lineTotal: dbDecimal("999") } });
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { subtotal: dbDecimal("888"), grandTotal: dbDecimal("777") },
      });

      const result = await issueInvoice(organizationId, invoiceId);
      const item = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId } });
      assert.equal(item.lineTotal.toString(), "20");
      assert.equal(result.subtotal.toString(), "20");
      assert.equal(result.grandTotal.toString(), "20");
    });
  });

  it("applies a valid discount to the recalculated subtotal", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { discountAmount: dbDecimal("5") } });
      const result = await issueInvoice(organizationId, invoiceId);
      assert.equal(result.subtotal.toString(), "20");
      assert.equal(result.discountAmount.toString(), "5");
      assert.equal(result.grandTotal.toString(), "15");
    });
  });

  it("rejects a discount greater than the recalculated subtotal", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { discountAmount: dbDecimal("20.01") } });
      await assert.rejects(issueInvoice(organizationId, invoiceId), InvoiceIssuanceError);
      await assertNoSequence(organizationId);
    });
  });

  it("rejects a negative discount", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { discountAmount: dbDecimal("-0.01") } });
      await assert.rejects(issueInvoice(organizationId, invoiceId), InvoiceIssuanceError);
      await assertNoSequence(organizationId);
    });
  });

  it("rejects invoices with no items", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoiceItem.deleteMany({ where: { invoiceId } });
      await assert.rejects(issueInvoice(organizationId, invoiceId), InvoiceIssuanceError);
      await assertNoSequence(organizationId);
    });
  });

  it("rejects negative quantity", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoiceItem.updateMany({ where: { invoiceId }, data: { quantity: dbDecimal("-1") } });
      await assert.rejects(issueInvoice(organizationId, invoiceId), InvoiceIssuanceError);
      await assertNoSequence(organizationId);
    });
  });

  it("rejects negative unit price", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoiceItem.updateMany({ where: { invoiceId }, data: { unitPrice: dbDecimal("-1") } });
      await assert.rejects(issueInvoice(organizationId, invoiceId), InvoiceIssuanceError);
      await assertNoSequence(organizationId);
    });
  });

  it("rejects reissuance unless the invoice remains a draft", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      for (const lifecycleStatus of ["ISSUED", "VOID", "SUPERSEDED", "WRITTEN_OFF"] as const) {
        await prisma.invoice.update({ where: { id: invoiceId }, data: { lifecycleStatus } });
        await assert.rejects(issueInvoice(organizationId, invoiceId), InvoiceIssuanceError);
      }
      await assertNoSequence(organizationId);
    });
  });

  it("does not issue an invoice through another organization's scope", async () => {
    await withFixture(async (first) => {
      await withFixture(async (second) => {
        await assert.rejects(
          issueInvoice(first.organizationId, second.invoiceId),
          /not found in this organization/,
        );
        const untouched = await prisma.invoice.findFirstOrThrow({
          where: { id: second.invoiceId, organizationId: second.organizationId },
        });
        assert.equal(untouched.lifecycleStatus, "DRAFT");
        await assertNoSequence(first.organizationId);
      });
    });
  });

  it("assigns sequential numbers across invoices", async () => {
    await withFixture(async ({ organizationId, invoiceId, clientId }) => {
      const secondInvoiceId = await createInvoice(organizationId, clientId);
      const first = await issueInvoice(organizationId, invoiceId);
      const second = await issueInvoice(organizationId, secondInvoiceId);
      assert.equal(first.invoiceNumber, "I202610091");
      assert.equal(second.invoiceNumber, "I202610092");
      const sequence = await prisma.invoiceSequence.findUniqueOrThrow({
        where: { organizationId_key: { organizationId, key: "DEFAULT" } },
      });
      assert.equal(sequence.nextValue, 3);
    });
  });

  it("atomically assigns unique increasing numbers to concurrent issuances", async () => {
    await withFixture(async ({ organizationId, invoiceId, clientId }) => {
      const secondInvoiceId = await createInvoice(organizationId, clientId);
      const thirdInvoiceId = await createInvoice(organizationId, clientId);
      const results = await Promise.all([
        issueInvoice(organizationId, invoiceId),
        issueInvoice(organizationId, secondInvoiceId),
        issueInvoice(organizationId, thirdInvoiceId),
      ]);
      const numbers = results.map(({ invoiceNumber }) => invoiceNumber).sort();

      assert.deepEqual(numbers, ["I202610091", "I202610092", "I202610093"]);
      const sequence = await prisma.invoiceSequence.findUniqueOrThrow({
        where: { organizationId_key: { organizationId, key: "DEFAULT" } },
      });
      assert.equal(sequence.nextValue, 4);
    });
  });

  it("allows only one concurrent issuance of the same draft and consumes one sequence value", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      const results = await Promise.allSettled([
        issueInvoice(organizationId, invoiceId),
        issueInvoice(organizationId, invoiceId),
      ]);
      const successes = results.filter((result) => result.status === "fulfilled");
      const failures = results.filter((result) => result.status === "rejected");
      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { id: invoiceId, organizationId },
      });
      const sequence = await prisma.invoiceSequence.findUniqueOrThrow({
        where: { organizationId_key: { organizationId, key: "DEFAULT" } },
      });

      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      assert.equal(invoice.lifecycleStatus, "ISSUED");
      assert.equal(invoice.invoiceNumber, "I202610091");
      assert.equal(sequence.nextValue, 2);
    });
  });

  it("preserves Decimal rounding for quantity 1.3333 and unit price 10.5555", async () => {
    await withFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoiceItem.updateMany({
        where: { organizationId, invoiceId },
        data: {
          quantity: dbDecimal("1.3333"),
          unitPrice: dbDecimal("10.5555"),
          lineTotal: dbDecimal("999"),
        },
      });

      const issued = await issueInvoice(organizationId, invoiceId);
      const item = await prisma.invoiceItem.findFirstOrThrow({
        where: { organizationId, invoiceId },
      });

      assert.equal(item.lineTotal.toFixed(4), "14.0736");
      assert.equal(issued.subtotal.toFixed(4), "14.0736");
      assert.equal(issued.grandTotal.toFixed(4), "14.0736");
      assert.equal(item.lineTotal instanceof Prisma.Decimal, true);
      assert.equal(issued.subtotal instanceof Prisma.Decimal, true);
      assert.equal(issued.grandTotal instanceof Prisma.Decimal, true);
    });
  });

  it("rolls back a reserved number when invoice persistence fails", async () => {
    await withFixture(async ({ organizationId, clientId, invoiceId }) => {
      await prisma.invoiceSequence.create({
        data: { organizationId, key: "DEFAULT", prefix: "I", nextValue: 77 },
      });
      const blockerId = await createInvoice(organizationId, clientId);
      await prisma.invoice.update({
        where: { id: blockerId },
        data: {
          lifecycleStatus: "ISSUED",
          invoiceNumber: "I2026100977",
          invoiceDate: new Date("2026-10-09T00:00:00.000Z"),
        },
      });

      await assert.rejects(issueInvoice(organizationId, invoiceId));
      const sequenceAfterFailure = await prisma.invoiceSequence.findUniqueOrThrow({
        where: { organizationId_key: { organizationId, key: "DEFAULT" } },
      });
      assert.equal(sequenceAfterFailure.nextValue, 77);

      await prisma.invoiceItem.deleteMany({ where: { invoiceId: blockerId } });
      await prisma.invoice.delete({ where: { id: blockerId } });
      const issued = await issueInvoice(organizationId, invoiceId);
      assert.equal(issued.invoiceNumber, "I2026100977");
      const sequenceAfterSuccess = await prisma.invoiceSequence.findUniqueOrThrow({
        where: { organizationId_key: { organizationId, key: "DEFAULT" } },
      });
      assert.equal(sequenceAfterSuccess.nextValue, 78);
    });
  });
});

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const organizationId = randomUUID();
  let created = false;
  try {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Invoice Issuance Test",
        slug: `invoice-issuance-${organizationId}`,
      },
    });
    created = true;
    const client = await prisma.client.create({
      data: {
        organizationId,
        name: "Snapshot Client",
        billingAddress: "10 Test Road",
        email: "client@example.test",
        phone: "+94112223344",
      },
    });
    const invoiceId = await createInvoice(organizationId, client.id);
    await run({ organizationId, clientId: client.id, invoiceId });
  } finally {
    if (created) {
      await prisma.invoiceItem.deleteMany({ where: { organizationId } });
      await prisma.invoice.deleteMany({ where: { organizationId } });
      await prisma.invoiceSequence.deleteMany({ where: { organizationId } });
      await prisma.client.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  }
}

async function createInvoice(organizationId: string, clientId: string): Promise<string> {
  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      clientId,
      invoiceDate: new Date("2026-10-09T00:00:00.000Z"),
      subtotal: dbDecimal("888"),
      grandTotal: dbDecimal("777"),
    },
  });
  await prisma.invoiceItem.create({
    data: {
      organizationId,
      invoiceId: invoice.id,
      description: "Service line",
      quantity: dbDecimal("2"),
      unitPrice: dbDecimal("10"),
      lineTotal: dbDecimal("999"),
      position: 0,
    },
  });
  return invoice.id;
}

async function assertNoSequence(organizationId: string): Promise<void> {
  const sequence = await prisma.invoiceSequence.findUnique({
    where: { organizationId_key: { organizationId, key: "DEFAULT" } },
  });
  assert.equal(sequence, null);
}
