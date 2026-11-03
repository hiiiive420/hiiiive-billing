import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { acquireInvoRequest, appendInvoUserMessage, detectInvoWrongMode, getInvoRetryDraft, INITIAL_INVO_ASSISTANT_VIEW_STATE, invoAssistantViewReducer } from "./invo-assistant-state";

describe("floating Invo assistant view state", () => {
  it("starts collapsed with its proactive greeting", () => {
    assert.deepEqual(INITIAL_INVO_ASSISTANT_VIEW_STATE, { open: false, greetingVisible: true, appliedMessage: null });
  });

  it("opens and hides the proactive greeting", () => {
    const state = invoAssistantViewReducer(INITIAL_INVO_ASSISTANT_VIEW_STATE, { type: "OPEN" });
    assert.equal(state.open, true);
    assert.equal(state.greetingVisible, false);
    assert.deepEqual(state, { open: true, greetingVisible: false, appliedMessage: null });
  });

  it("minimizes and reopens without clearing assistant state", () => {
    const open = invoAssistantViewReducer(INITIAL_INVO_ASSISTANT_VIEW_STATE, { type: "OPEN" });
    const minimized = invoAssistantViewReducer(open, { type: "MINIMIZE" });
    const reopened = invoAssistantViewReducer(minimized, { type: "OPEN" });
    assert.equal(minimized.open, false);
    assert.equal(reopened.open, true);
    assert.equal(reopened.greetingVisible, false);
  });

  it("dismisses only the proactive greeting", () => {
    const dismissed = invoAssistantViewReducer(INITIAL_INVO_ASSISTANT_VIEW_STATE, { type: "DISMISS_GREETING" });
    assert.equal(dismissed.greetingVisible, false);
    assert.equal(dismissed.open, false);
  });

  it("shows target-specific confirmation only after explicit apply", () => {
    const invoice = invoAssistantViewReducer(INITIAL_INVO_ASSISTANT_VIEW_STATE, { type: "APPLIED", target: "INVOICE" });
    const recurring = invoAssistantViewReducer(INITIAL_INVO_ASSISTANT_VIEW_STATE, { type: "APPLIED", target: "RECURRING" });
    assert.match(invoice.appliedMessage ?? "", /Applied to the invoice form/);
    assert.match(recurring.appliedMessage ?? "", /Applied to the recurring plan form/);
    assert.match(recurring.appliedMessage ?? "", /create the plan/i);
  });

  it("clears the post-apply note on Start over without closing the panel", () => {
    const applied = invoAssistantViewReducer(INITIAL_INVO_ASSISTANT_VIEW_STATE, { type: "APPLIED", target: "INVOICE" });
    const reset = invoAssistantViewReducer(applied, { type: "START_OVER" });
    assert.equal(reset.open, true);
    assert.equal(reset.appliedMessage, null);
  });

  it("returns the user to detail entry after Change details", () => {
    const applied = invoAssistantViewReducer(INITIAL_INVO_ASSISTANT_VIEW_STATE, { type: "APPLIED", target: "RECURRING" });
    const editing = invoAssistantViewReducer(applied, { type: "CHANGE_DETAILS" });
    assert.equal(editing.open, true);
    assert.equal(editing.appliedMessage, null);
  });

  it("locks one active send against rapid repeated submissions", () => {
    const lock = { current: false };
    let requests = 0;
    if (acquireInvoRequest(lock)) requests += 1;
    if (acquireInvoRequest(lock)) requests += 1;
    assert.equal(requests, 1);
    lock.current = false;
    assert.equal(acquireInvoRequest(lock), true);
  });

  it("adds exactly one user bubble and reuses it after Try again", () => {
    const messages = appendInvoUserMessage([], "Invoice SESo2 for website maintenance", null);
    const retry = appendInvoUserMessage(messages, "Invoice SESo2 for website maintenance", "Invoice SESo2 for website maintenance");
    assert.equal(messages.length, 1);
    assert.equal(retry.length, 1);
    assert.equal(retry, messages);
  });

  it("Try again only restores failed text to the composer", () => {
    const calls = 0;
    const draft = getInvoRetryDraft([{ role: "user", content: "Invoice SESo2 for website maintenance" }]);
    assert.equal(draft, "Invoice SESo2 for website maintenance");
    assert.equal(calls, 0);
  });

  it("detects explicit requests for the other page without changing the target", () => {
    assert.equal(detectInvoWrongMode("RECURRING", "Invoice SESo2 for website maintenance"), "INVOICE");
    assert.equal(detectInvoWrongMode("INVOICE", "Create annual billing for Domain cost"), "RECURRING");
    assert.equal(detectInvoWrongMode("RECURRING", "Create an annual plan"), null);
  });

  it("wires both production create pages to the shared assistant in their page mode", () => {
    const invoicePage = readFileSync(new URL("../../app/app/[organizationSlug]/invoices/new/page.tsx", import.meta.url), "utf8");
    const invoiceForm = readFileSync(new URL("./invoice-entry-form.tsx", import.meta.url), "utf8");
    const recurringPage = readFileSync(new URL("../../app/app/[organizationSlug]/recurring/new/page.tsx", import.meta.url), "utf8");
    const recurringForm = readFileSync(new URL("../recurring/recurring-plan-form.tsx", import.meta.url), "utf8");
    const assistant = readFileSync(new URL("./invo-assistant.tsx", import.meta.url), "utf8");
    assert.match(invoicePage, /sendInvoMessage/);
    assert.match(invoiceForm, /<InvoAssistant target="INVOICE"/);
    assert.match(recurringPage, /sendInvoMessage/);
    assert.match(recurringForm, /<InvoAssistant target="RECURRING"/);
    assert.match(assistant, /Hi! Want help creating this invoice\?/);
    assert.match(assistant, /Hi! Want help setting up this recurring plan\?/);
    assert.match(assistant, /Tell Invo what you want to invoice\.\.\./);
    assert.match(assistant, /Tell Invo about the recurring billing plan\.\.\./);
  });
});
