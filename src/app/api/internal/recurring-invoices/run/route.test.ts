import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { handleRecurringInvoiceCron } from "./cron-auth";

const secret = "test-only-recurring-cron-secret-with-over-32-characters";
const priorSecret = process.env.RECURRING_INVOICE_CRON_SECRET;
afterEach(() => {
  if (priorSecret === undefined) delete process.env.RECURRING_INVOICE_CRON_SECRET;
  else process.env.RECURRING_INVOICE_CRON_SECRET = priorSecret;
});

test("recurring cron authorization rejects missing, malformed, wrong, and different-length secrets", async () => {
  process.env.RECURRING_INVOICE_CRON_SECRET = secret;
  let runnerCalls = 0;
  const run = async () => { runnerCalls += 1; return { checked: 0, results: [] }; };
  const missing = await handleRecurringInvoiceCron(new Request("http://localhost/api/internal/recurring-invoices/run", { method: "POST" }), run);
  assert.equal(missing.status, 401);
  const malformed = await handleRecurringInvoiceCron(new Request("http://localhost/api/internal/recurring-invoices/run", { method: "POST", headers: { Authorization: `Basic ${secret}` } }), run);
  assert.equal(malformed.status, 401);
  const noBearerToken = await handleRecurringInvoiceCron(new Request("http://localhost/api/internal/recurring-invoices/run", { method: "POST", headers: { Authorization: "Bearer" } }), run);
  assert.equal(noBearerToken.status, 401);
  const rawSecretWithoutScheme = await handleRecurringInvoiceCron(new Request("http://localhost/api/internal/recurring-invoices/run", { method: "POST", headers: { Authorization: secret } }), run);
  assert.equal(rawSecretWithoutScheme.status, 401);
  const multipleTokens = await handleRecurringInvoiceCron(new Request("http://localhost/api/internal/recurring-invoices/run", { method: "POST", headers: { Authorization: `Bearer ${secret} extra` } }), run);
  assert.equal(multipleTokens.status, 401);
  const wrong = await handleRecurringInvoiceCron(new Request("http://localhost/api/internal/recurring-invoices/run", { method: "POST", headers: { Authorization: "Bearer wrong" } }), run);
  assert.equal(wrong.status, 401);
  assert.equal(runnerCalls, 0);
});

test("the configured bearer secret runs without browser session auth and is never returned", async () => {
  process.env.RECURRING_INVOICE_CRON_SECRET = secret;
  let runnerCalls = 0;
  const request = new Request("http://localhost/api/internal/recurring-invoices/run", {
    method: "POST", headers: { Authorization: `Bearer ${secret}` },
  });
  const response = await handleRecurringInvoiceCron(request, async () => {
    runnerCalls += 1;
    return { checked: 0, results: [] };
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(runnerCalls, 1);
  assert.equal(body.includes(secret), false);
  assert.deepEqual(JSON.parse(body), { checked: 0, results: [] });
});

test("an absent or undersized environment secret fails closed", async () => {
  delete process.env.RECURRING_INVOICE_CRON_SECRET;
  const unconfigured = await handleRecurringInvoiceCron(new Request("http://localhost/api/internal/recurring-invoices/run", { method: "POST" }), async () => ({ checked: 0, results: [] }));
  assert.equal(unconfigured.status, 503);
  process.env.RECURRING_INVOICE_CRON_SECRET = "too-short";
  const undersized = await handleRecurringInvoiceCron(new Request("http://localhost/api/internal/recurring-invoices/run", { method: "POST", headers: { Authorization: "Bearer too-short" } }), async () => ({ checked: 0, results: [] }));
  assert.equal(undersized.status, 503);
});
