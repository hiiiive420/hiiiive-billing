"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function IssueInvoiceControl({ issue, invoiceBasePath, invoiceId, beforeIssue, disabled = false }: { issue: (invoiceId?: string) => Promise<{ ok: true; invoiceId: string; invoiceNumber: string } | { ok: false; error: string }>; invoiceBasePath: string; invoiceId?: string; beforeIssue?: () => Promise<boolean>; disabled?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function confirmIssue() {
    setError("");
    startTransition(async () => {
      if (beforeIssue && !await beforeIssue()) { setError("Save the latest draft changes before issuing."); return; }
      const result = await issue(invoiceId);
      if (result.ok) router.replace(`${invoiceBasePath}/${encodeURIComponent(result.invoiceId)}`);
      else setError(invoiceId ? `Draft saved, but the invoice could not be issued. ${result.error}` : result.error);
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
