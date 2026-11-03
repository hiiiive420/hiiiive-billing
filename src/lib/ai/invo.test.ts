import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInvoRequest, normalizeInvoProposal, parseInvoResponse, type InvoStructuredResponse } from "./invo";

const response: InvoStructuredResponse = {
  state: "READY_PROPOSAL", assistantMessage: "Ready for review.", target: "INVOICE", missingFields: [], ambiguities: [],
  proposal: {
    clientHint: "Visaga", planName: null, projectTitle: null, invoiceDate: null, dueDate: null, dueInDays: null,
    currencyCode: "LKR", frequency: null, startDate: null, discountLabel: null, discountAmount: null,
    paymentTerms: null, notes: null,
    items: [{ billingMode: "FLAT_FEE", serviceHint: null, description: "Social media", quantity: null, unitPrice: null, amount: "55,000" }],
  },
};

describe("Invo structured conversation boundary", () => {
  it("builds bounded Responses API Structured Output requests with storage disabled", () => {
    const request = buildInvoRequest("INVOICE", [{ role: "user", content: "Invoice Visaga LKR 55,000 for social media" }], new Date("2026-11-02T00:00:00Z"), "gpt-6-luna", { clients: ["Visaga"] });
    assert.equal(request.store, false);
    assert.equal(request.model, "gpt-6-luna");
    assert.match(request.instructions, /2026-11-02/);
    assert.match(request.input, /social media/);
  });

  it("uses injected OpenAI boundary and returns a strict invoice proposal", async () => {
    let calls = 0;
    const parsed = await parseInvoResponse("INVOICE", [{ role: "user", content: "Invoice Visaga LKR 55,000 for social media" }], {}, {
      env: { OPENAI_API_KEY: "test-key", OPENAI_INVOICE_MODEL: "gpt-6-luna" },
      request: async () => { calls += 1; return response; },
    });
    assert.equal(calls, 1);
    assert.equal(parsed.state, "READY_PROPOSAL");
    assert.equal(parsed.proposal.items[0]?.amount, "55,000");
    assert.equal("total" in parsed.proposal, false);
  });

  it("rejects a model response that switches target mode", async () => {
    await assert.rejects(parseInvoResponse("RECURRING", [{ role: "user", content: "create a plan" }], {}, {
      env: { OPENAI_API_KEY: "test-key" }, request: async () => response,
    }));
  });

  it("maps OpenAI failures safely and emits only status/code diagnostics in development", async () => {
    const originalError = console.error;
    const diagnostics: string[] = [];
    console.error = (...args: unknown[]) => diagnostics.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
    try {
      await assert.rejects(parseInvoResponse("INVOICE", [{ role: "user", content: "Invoice Visaga" }], {}, {
        env: { OPENAI_API_KEY: "never-log-this", OPENAI_INVOICE_MODEL: "gpt-6-luna", NODE_ENV: "development" },
        request: async () => { throw Object.assign(new Error("sensitive request payload"), { status: 401, code: "expired_secret_key" }); },
      }), /Invo is temporarily unavailable/);
    } finally { console.error = originalError; }
    const output = diagnostics.join(" ");
    assert.match(output, /API_CALL/);
    assert.match(output, /apiKeyConfigured/);
    assert.match(output, /401/);
    assert.match(output, /expired_secret_key/);
    assert.match(output, /configured OpenAI API key has expired/);
    assert.doesNotMatch(output, /never-log-this|sensitive request payload/);
  });

  it("normalizes safely grouped values and rejects malformed grouping", () => {
    const good = normalizeInvoProposal({ ...response.proposal, items: [{ ...response.proposal.items[0]!, amount: "55,000" }] });
    assert.equal(good.items[0]?.amount, "55000");
    const bad = normalizeInvoProposal({ ...response.proposal, items: [{ ...response.proposal.items[0]!, amount: "5,50,00" }] });
    assert.equal(bad.items[0]?.amount, null);
  });
});
