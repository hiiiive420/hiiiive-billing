"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Client = { id: string; name: string };
type Item = { billingMode: "QUANTITY" | "FLAT_FEE"; description: string; quantity: string; unitPrice: string; amount: string };
type Initial = {
  clientId: string; name: string; projectTitle: string; currencyCode: string; frequency: "MONTHLY" | "YEARLY";
  startDate: string; dueInDays: string; discountLabel: string; discountAmount: string; paymentTerms: string; notes: string;
  items: Item[];
};

export function RecurringPlanForm({ organizationSlug, clients, save, planId, initial }: {
  organizationSlug: string; clients: Client[];
  save: (planId: string | null, value: unknown) => Promise<{ ok: true; planId: string } | { ok: false; error: string }>;
  planId?: string; initial?: Initial;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Initial>(initial ?? {
    clientId: "", name: "", projectTitle: "", currencyCode: "LKR", frequency: "MONTHLY", startDate: "",
    dueInDays: "", discountLabel: "", discountAmount: "0", paymentTerms: "", notes: "",
    items: [{ billingMode: "QUANTITY", description: "", quantity: "1", unitPrice: "", amount: "" }],
  });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const base = `/app/${encodeURIComponent(organizationSlug)}/recurring`;
  const change = <K extends keyof Initial>(key: K, value: Initial[K]) => setForm((current) => ({ ...current, [key]: value }));
  function submit() {
    setError("");
    startTransition(async () => {
      const result = await save(planId ?? null, form);
      if (!result.ok) { setError(result.error); return; }
      router.replace(`${base}/${encodeURIComponent(result.planId)}`);
      router.refresh();
    });
  }
  return <section className="entry-card recurring-form">
    <div className="entry-field-grid">
      <Field label="Plan name"><input value={form.name} maxLength={120} onChange={(e) => change("name", e.target.value)} /></Field>
      <Field label="Client"><select value={form.clientId} onChange={(e) => change("clientId", e.target.value)}><option value="">Choose a client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field>
      <Field label="Project title (optional)"><input value={form.projectTitle} onChange={(e) => change("projectTitle", e.target.value)} /></Field>
      <Field label="Currency"><input value={form.currencyCode} maxLength={3} onChange={(e) => change("currencyCode", e.target.value.toUpperCase())} /></Field>
      <Field label="Frequency"><select value={form.frequency} onChange={(e) => change("frequency", e.target.value as Initial["frequency"])}><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></Field>
      <Field label="First scheduled date"><input type="date" value={form.startDate} onChange={(e) => change("startDate", e.target.value)} /></Field>
      <Field label="Due in days (optional)"><input type="number" min="0" max="3650" value={form.dueInDays} onChange={(e) => change("dueInDays", e.target.value)} /></Field>
      <Field label="Discount label (optional)"><input value={form.discountLabel} onChange={(e) => change("discountLabel", e.target.value)} /></Field>
      <Field label="Discount amount"><input inputMode="decimal" value={form.discountAmount} onChange={(e) => change("discountAmount", e.target.value)} /></Field>
      <Field label="Payment terms (optional)"><input value={form.paymentTerms} onChange={(e) => change("paymentTerms", e.target.value)} /></Field>
    </div>
    <section className="recurring-items" aria-label="Recurring items">
      <div className="entry-section-heading"><div><h2>Recurring items</h2><p>Prices are saved with this plan. Service defaults will not replace them.</p></div>
        <button className="entry-button entry-button-light" type="button" onClick={() => change("items", [...form.items, { billingMode: "QUANTITY", description: "", quantity: "1", unitPrice: "", amount: "" }])}>＋ Add item</button></div>
      {form.items.map((item, index) => <div className="entry-field-grid recurring-item" key={index}>
        <Field label={`Item ${index + 1} description`}><input value={item.description} onChange={(e) => change("items", form.items.map((row, i) => i === index ? { ...row, description: e.target.value } : row))} /></Field>
        <Field label="Billing mode"><select value={item.billingMode} onChange={(e) => change("items", form.items.map((row, i) => i === index ? { ...row, billingMode: e.target.value as Item["billingMode"] } : row))}><option value="QUANTITY">Quantity × unit price</option><option value="FLAT_FEE">Flat fee</option></select></Field>
        {item.billingMode === "QUANTITY" ? <><Field label="Quantity"><input inputMode="decimal" value={item.quantity} onChange={(e) => change("items", form.items.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} /></Field><Field label={`Unit price (${form.currencyCode})`}><input inputMode="decimal" value={item.unitPrice} onChange={(e) => change("items", form.items.map((row, i) => i === index ? { ...row, unitPrice: e.target.value } : row))} /></Field></> : <Field label={`Amount (${form.currencyCode})`}><input inputMode="decimal" value={item.amount} onChange={(e) => change("items", form.items.map((row, i) => i === index ? { ...row, amount: e.target.value } : row))} /></Field>}
        {form.items.length > 1 && <button className="entry-text-button" type="button" onClick={() => change("items", form.items.filter((_, i) => i !== index))}>Remove item</button>}
      </div>)}
    </section>
    <Field label="Notes (optional)"><textarea rows={4} value={form.notes} onChange={(e) => change("notes", e.target.value)} /></Field>
    {error && <p className="entry-error" role="alert">{error}</p>}
    <div className="entry-actions"><button className="entry-button entry-button-primary" type="button" onClick={submit} disabled={pending}>{pending ? "Saving…" : planId ? "Save plan" : "Create plan"}</button><a className="entry-button entry-button-light" href={base}>Cancel</a></div>
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="entry-field"><label>{label}{children}</label></div>; }
