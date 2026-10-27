"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { normalizeMoneyInput } from "@/lib/invoices/invoice-entry-ui";

type PaymentAction = (input: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;

export function InvoicePaymentForm({ currencyCode, initialDate, action }: { currencyCode: string; initialDate: string; action: PaymentAction }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(initialDate);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await action({ amount: normalizeMoneyInput(amount), paidAt, method, reference, internalNote });
      if (!result.ok) { setMessage({ type: "error", text: result.error }); return; }
      setAmount("");
      setReference("");
      setInternalNote("");
      setMessage({ type: "success", text: "Payment recorded." });
      router.refresh();
    });
  }

  return <form id="record-payment" className="entry-card invoice-payment-form" onSubmit={submit}>
    <div className="entry-section-heading"><div><h2>Record Payment</h2><p>Record a payment in {currencyCode}. Invoice currency is fixed.</p></div></div>
    <div className="invoice-payment-form-grid">
      <label className="entry-field">Amount ({currencyCode})<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={64} /></label>
      <label className="entry-field">Payment date<input required type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
      <label className="entry-field">Method<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="CHEQUE">Cheque</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label>
      <label className="entry-field">Reference (optional)<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={200} /></label>
      <label className="entry-field invoice-payment-note">Internal note (optional)<textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} maxLength={2000} /></label>
    </div>
    {message && <p className={message.type === "success" ? "invoice-payment-success" : "invoice-payment-error"} role={message.type === "success" ? "status" : "alert"}>{message.text}</p>}
    <button className="entry-button entry-button-primary" type="submit" disabled={pending}>{pending ? "Recording…" : "Record Payment"}</button>
  </form>;
}
