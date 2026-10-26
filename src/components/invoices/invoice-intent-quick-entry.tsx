"use client";

import { useState, useTransition } from "react";
import type { InvoiceIntentActionResult, InvoiceIntentSuggestion } from "@/lib/ai/invoice-intent-contract";

export function InvoiceIntentQuickEntry({
  generate,
  hasExistingData,
  onApply,
}: {
  generate: (text: string) => Promise<InvoiceIntentActionResult>;
  hasExistingData: boolean;
  onApply: (suggestion: InvoiceIntentSuggestion) => void;
}) {
  const [text, setText] = useState("");
  const [suggestion, setSuggestion] = useState<InvoiceIntentSuggestion | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuggestion(null);
    startTransition(async () => {
      const result = await generate(text);
      if (result.ok) setSuggestion(result.suggestion);
      else setError(result.error);
    });
  }

  return <section className="entry-card invoice-ai-card" aria-labelledby="invoice-ai-heading">
    <div className="entry-section-heading"><span className="entry-step">AI</span><div><h2 id="invoice-ai-heading">Quick Invoice with AI</h2><p>Describe the invoice. Review the suggestion before applying it to the form.</p></div></div>
    <form className="invoice-ai-input" onSubmit={submit}>
      <label className="entry-field" htmlFor="invoice-ai-text">Invoice description
        <textarea id="invoice-ai-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={3} required placeholder="Invoice Visaga LKR 55,000 for October social media management, due in 14 days." />
        <small>Text only, up to 2,000 characters. Do not include confidential information.</small>
      </label>
      <button className="entry-button entry-button-primary" type="submit" disabled={pending || text.trim().length < 5}>{pending ? "Generating suggestion…" : "Generate"}</button>
    </form>
    {pending && <p className="entry-hint" role="status">Reading the invoice details…</p>}
    {error && <p className="entry-inline-error" role="alert">{error}</p>}
    {suggestion && <div className="invoice-ai-suggestion" aria-live="polite">
      <h3>Review suggestion</h3>
      <dl>
        <div><dt>Client</dt><dd>{suggestion.resolvedClient?.displayName ?? suggestion.intent.clientHint ?? "Not provided"}{suggestion.resolvedClient ? " — matched existing client" : suggestion.intent.clientHint ? " — choose using the client search below" : ""}</dd></div>
        <div><dt>Project</dt><dd>{suggestion.intent.projectTitle ?? "Not provided"}</dd></div>
        <div><dt>Currency</dt><dd>{suggestion.intent.currencyCode ?? "Needs your choice"}</dd></div>
        <div><dt>Items</dt><dd>{suggestion.intent.items.length ? <ul>{suggestion.intent.items.map((item, index) => {
          const service = suggestion.resolvedServices.find((match) => match.itemIndex === index)?.service;
          return <li key={index}>
            {item.description ?? item.serviceHint ?? "Description needed"}{service ? ` — matched service: ${service.name}` : ""} ({item.billingMode === "FLAT_FEE" ? "Flat fee" : "Quantity"})
            {item.billingMode === "FLAT_FEE"
              ? item.amount === null ? "; amount needed" : `; ${suggestion.intent.currencyCode ?? "Currency needed"} ${item.amount}`
              : `; quantity ${item.quantity ?? "needed"}, unit price ${item.unitPrice === null ? "needed" : `${suggestion.intent.currencyCode ?? "Currency needed"} ${item.unitPrice}`}`}
          </li>;
        })}</ul> : "Item details needed"}</dd></div>
        <div><dt>Due</dt><dd>{suggestion.intent.dueDate ?? (suggestion.intent.dueInDays === null ? "Not provided" : `${suggestion.intent.dueInDays} days from invoice date or today`)}</dd></div>
        {suggestion.intent.discountAmount !== null && <div><dt>Discount</dt><dd>{suggestion.intent.discountLabel ?? "Fixed discount"}: {suggestion.intent.currencyCode ?? "Currency needed"} {suggestion.intent.discountAmount}</dd></div>}
      </dl>
      {suggestion.ambiguities.length > 0 && <div className="invoice-ai-notes"><strong>Needs review</strong><ul>{suggestion.ambiguities.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
      {suggestion.missingInformation.length > 0 && <div className="invoice-ai-notes"><strong>Missing</strong><ul>{suggestion.missingInformation.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
      <button className="entry-button entry-button-light" type="button" onClick={() => onApply(suggestion)}>
        {hasExistingData ? "Apply suggestion and replace entered form fields" : "Apply to Invoice Form"}
      </button>
    </div>}
  </section>;
}
