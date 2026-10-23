"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function IssueInvoiceControl({ issue, invoiceBasePath, disabled = false }: { issue: () => Promise<{ ok: true; invoiceId: string; invoiceNumber: string } | { ok: false; error: string }>; invoiceBasePath: string; disabled?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function confirmIssue() {
    setError("");
    startTransition(async () => {
      const result = await issue();
      if (result.ok) router.replace(`${invoiceBasePath}/${encodeURIComponent(result.invoiceId)}`);
      else setError(result.error);
    });
  }
  return <div className="issue-control">
    {!confirming ? <button className="entry-button entry-button-primary" type="button" onClick={() => setConfirming(true)} disabled={disabled}>Issue Invoice</button> : <div className="issue-confirm" role="group" aria-label="Confirm invoice issuance">
      <p>Issuing assigns a permanent invoice number and freezes the invoice date, client details, and template version. This invoice cannot be edited afterward.</p>
      <button className="entry-button entry-button-primary" type="button" onClick={confirmIssue} disabled={pending || disabled}>{pending ? "Issuing…" : "Confirm Issue"}</button>
      <button className="entry-button entry-button-light" type="button" onClick={() => setConfirming(false)} disabled={pending}>Cancel</button>
    </div>}
    {error && <p className="entry-error" role="alert">{error}</p>}
  </div>;
}
