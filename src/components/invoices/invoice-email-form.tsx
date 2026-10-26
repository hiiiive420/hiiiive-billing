"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

type EmailAction = (input: unknown) => Promise<{ ok: true; attemptId: string } | { ok: false; error: string }>;

export function InvoiceEmailForm({
  invoiceNumber, fromDisplay, senderConfigured, attachmentFilename, initialTo, subject: initialSubject,
  bodyText: initialBody, recentAttempts, workspaceHref, invoiceHref, sendAction,
}: {
  invoiceNumber: string;
  fromDisplay: string;
  senderConfigured: boolean;
  attachmentFilename: string;
  initialTo: string;
  subject: string;
  bodyText: string;
  recentAttempts: readonly { id: string; status: "PENDING" | "SENT" | "PARTIALLY_SENT" | "FAILED"; timestamp: string; toRecipients: readonly string[]; ccCount: number }[];
  workspaceHref: string;
  invoiceHref: string;
  sendAction: EmailAction;
}) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [bodyText, setBodyText] = useState(initialBody);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSent(false);
    startTransition(async () => {
      const result = await sendAction({ to, cc, bcc, subject, bodyText });
      if (result.ok) setSent(true);
      else setError(result.error);
    });
  }

  return <main className="entry-page entry-page-production email-page">
    <div className="entry-workspace-bar"><strong>Hiiiive Billing</strong><Link href={workspaceHref}>Invoices</Link><span>Invoice {invoiceNumber}</span></div>
    <header className="entry-header">
      <div><div className="entry-eyebrow">INVOICES <span>/</span> EMAIL</div><div className="entry-title-row"><h1>Send Invoice {invoiceNumber}</h1></div></div>
      <Link className="entry-button entry-button-light" href={invoiceHref}>Back to Invoice</Link>
    </header>
    {error && <div className="entry-error" role="alert">{error}</div>}
    {sent && <div className="entry-success" role="status"><strong>Invoice email sent.</strong> A new send attempt was recorded.</div>}
    {!senderConfigured && <div className="entry-error" role="status">Sender configuration is required before an invoice email can be sent.</div>}
    <div className="email-layout">
      <section className="entry-card">
        <div className="entry-section-heading"><span className="entry-step">✉</span><div><h2>Email details</h2><p>Review recipients and message before sending the official issued invoice.</p></div></div>
        <form className="email-compose" onSubmit={submit}>
          <div className="entry-field"><label htmlFor="invoice-email-from">From</label><input id="invoice-email-from" value={fromDisplay} readOnly /></div>
          <div className="entry-field"><label htmlFor="invoice-email-to">To <span aria-hidden="true">*</span></label><textarea id="invoice-email-to" value={to} onChange={(event) => setTo(event.target.value)} required rows={2} maxLength={4000} aria-describedby="recipient-help" autoComplete="email" /><small id="recipient-help">Separate multiple addresses with commas, semicolons, or new lines.</small></div>
          <div className="entry-field"><label htmlFor="invoice-email-cc">CC</label><textarea id="invoice-email-cc" value={cc} onChange={(event) => setCc(event.target.value)} rows={2} maxLength={4000} /></div>
          <div className="entry-field"><label htmlFor="invoice-email-bcc">BCC</label><textarea id="invoice-email-bcc" value={bcc} onChange={(event) => setBcc(event.target.value)} rows={2} maxLength={4000} /></div>
          <div className="entry-field"><label htmlFor="invoice-email-subject">Subject</label><input id="invoice-email-subject" value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={200} /></div>
          <div className="entry-field"><label htmlFor="invoice-email-body">Message</label><textarea id="invoice-email-body" value={bodyText} onChange={(event) => setBodyText(event.target.value)} required rows={14} maxLength={10000} /></div>
          <div className="email-attachment"><span>Attachment</span><strong>{attachmentFilename}</strong><small>Official PDF generated from the frozen issued invoice.</small></div>
          <div className="email-form-actions"><Link className="entry-button entry-button-light" href={invoiceHref}>Cancel</Link><button className="entry-button entry-button-primary" type="submit" disabled={pending || !senderConfigured}>{pending ? "Sending…" : "Send Invoice"}</button></div>
        </form>
      </section>
      <aside className="entry-card email-history" aria-labelledby="email-history-title">
        <div className="entry-section-heading"><div><h2 id="email-history-title">Recent attempts</h2><p>Latest 5 email attempts. BCC recipients are hidden.</p></div></div>
        {recentAttempts.length === 0 ? <p className="entry-hint">No send attempts yet.</p> : <ol>{recentAttempts.map((attempt) => <li key={attempt.id}>
          <div><strong className={`email-history-status email-history-${attempt.status.toLowerCase()}`}>{attempt.status === "PARTIALLY_SENT" ? "Partially sent" : attempt.status}</strong><time dateTime={attempt.timestamp}>{formatUtcTimestamp(attempt.timestamp)}</time></div>
          <span>To: {attempt.toRecipients.join(", ")}</span><span>CC recipients: {attempt.ccCount}</span>
        </li>)}</ol>}
      </aside>
    </div>
  </main>;
}

function formatUtcTimestamp(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}
