"use client";

import Image from "next/image";
import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import type { InvoActionResult, InvoDefaultPriceOffer, InvoMessage, InvoResult, InvoTarget } from "@/lib/ai/invo-contract";
import { acquireInvoRequest, appendInvoUserMessage, detectInvoWrongMode, getInvoRetryDraft, INITIAL_INVO_ASSISTANT_VIEW_STATE, invoAssistantViewReducer } from "./invo-assistant-state";

const INVO_MASCOT_SRC = "/branding/invo-mascot.webp";

export function InvoAssistant({ target, send, onApply, wrongModeHref }: {
  target: InvoTarget;
  send: (target: InvoTarget, messages: readonly InvoMessage[], offers: readonly string[]) => Promise<InvoActionResult>;
  onApply: (result: InvoResult) => void;
  wrongModeHref: string;
}) {
  const [view, dispatch] = useReducer(invoAssistantViewReducer, INITIAL_INVO_ASSISTANT_VIEW_STATE);
  const [messages, setMessages] = useState<InvoMessage[]>([]);
  const [result, setResult] = useState<InvoResult | null>(null);
  const [offers, setOffers] = useState<InvoDefaultPriceOffer[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [modeLink, setModeLink] = useState(false);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const retryContent = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (view.open) {
      wasOpen.current = true;
      textarea.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      trigger.current?.focus();
    }
  }, [view.open]);

  useEffect(() => {
    if (!view.open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "MINIMIZE" });
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view.open]);

  useEffect(() => {
    if (!view.greetingVisible || view.open) return;
    const timer = window.setTimeout(() => dispatch({ type: "DISMISS_GREETING" }), 14_000);
    return () => window.clearTimeout(timer);
  }, [view.greetingVisible, view.open]);

  useEffect(() => {
    if (view.open) conversationEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, pending, result, view.appliedMessage, view.open]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || pending || content.length > 2000 || !acquireInvoRequest(sending)) return;
    setDraft(""); setError(""); setModeLink(false); setResult(null);
    const next = appendInvoUserMessage(messages, content, retryContent.current);
    const retryingFailedMessage = next === messages;
    if (!retryingFailedMessage) setMessages(next);
    retryContent.current = null;
    const wrongTarget = detectInvoWrongMode(target, content);
    if (wrongTarget) {
      const destination = wrongTarget === "INVOICE" ? "an invoice" : "a recurring plan";
      const reply = `This Invo session is preparing ${target === "INVOICE" ? "an invoice" : "a recurring plan"}. To prepare ${destination}, open the ${wrongTarget === "INVOICE" ? "New Invoice" : "Recurring Plan"} page.`;
      setMessages([...next, { role: "assistant" as const, content: reply }].slice(-14));
      setModeLink(true);
      sending.current = false;
      return;
    }
    startTransition(async () => {
      try {
        const response = await send(target, next, offers.slice(-10).map((offer) => offer.token));
        if (!response.ok) { setError(response.error); retryContent.current = content; return; }
        handleResponse(response);
      } catch {
        setError("Invo couldn't process that request right now. You can try again or continue manually.");
        retryContent.current = content;
      } finally {
        sending.current = false;
      }
    });
  }

  function handleResponse(response: InvoActionResult) {
    if (!response.ok) { setError(response.error); return; }
    setResult(response.result);
    if (response.result.defaultPriceOffers.length) setOffers((current) => [...current, ...response.result.defaultPriceOffers].slice(-10));
    setMessages((current) => [...current, { role: "assistant" as const, content: response.result.assistantMessage }].slice(-14));
  }

  function retry() {
    if (pending || sending.current) return;
    const failedText = getInvoRetryDraft(messages);
    if (failedText === null) return;
    setError("");
    retryContent.current = failedText;
    setDraft(failedText);
    textarea.current?.focus();
  }

  function openAssistant() { dispatch({ type: "OPEN" }); }
  function minimize() { dispatch({ type: "MINIMIZE" }); }
  function reset() {
    retryContent.current = null;
    setModeLink(false);
    setMessages([]); setResult(null); setOffers([]); setDraft(""); setError("");
    dispatch({ type: "START_OVER" });
    textarea.current?.focus();
  }
  function changeDetails() {
    setResult(null); dispatch({ type: "CHANGE_DETAILS" }); textarea.current?.focus();
  }
  function applyProposal(proposal: InvoResult) {
    onApply(proposal);
    dispatch({ type: "APPLIED", target });
    setResult(null);
  }
  function setStarter(value: string) { setDraft(value); textarea.current?.focus(); }

  return <div className="invo-floating-root">
    {!view.open && <>
      {view.greetingVisible && <div className="invo-greeting">
        <button type="button" onClick={openAssistant}>{target === "INVOICE" ? "Hi! Want help creating this invoice?" : "Hi! Want help setting up this recurring plan?"}</button>
        <button type="button" aria-label="Dismiss Invo greeting" onClick={() => dispatch({ type: "DISMISS_GREETING" })}>×</button>
      </div>}
      <button ref={trigger} type="button" className="invo-float-trigger" onClick={openAssistant} aria-label="Open Invo AI Billing Assistant" aria-haspopup="dialog">
        <InvoAvatar size="trigger" />
      </button>
    </>}

    {view.open && <section className="invo-panel" role="dialog" aria-modal="false" aria-labelledby="invo-heading">
      <header className="invo-panel-header">
        <InvoAvatar size="header" />
        <div className="invo-panel-brand"><h2 id="invo-heading">Invo</h2><p>{target === "INVOICE" ? "Invoice assistant" : "Recurring assistant"}</p></div>
        <div className="invo-panel-actions">
          <button type="button" className="invo-panel-icon-action" aria-label="Start over" onClick={reset} disabled={pending}>↻</button>
          <button type="button" className="invo-panel-icon-action" aria-label="Minimize Invo" onClick={minimize}>−</button>
        </div>
      </header>
      <div className="invo-conversation" aria-live="polite" aria-relevant="additions text">
        {!messages.length && <div className="invo-empty-state">
          <p>{target === "INVOICE" ? "I can help prepare an invoice proposal for you to review." : "I can help prepare a recurring plan proposal for you to review."}</p>
          <div className="invo-starter-chips" aria-label="Suggested requests">
            {(target === "INVOICE" ? ["Invoice a client", "Create a flat-fee invoice", "Bill for a service"] : ["Create monthly billing", "Create yearly renewal"]).map((value) => <button type="button" key={value} onClick={() => setStarter(value)}>{value}</button>)}
          </div>
        </div>}
        {messages.map((message, index) => <div className={`invo-message-row invo-row-${message.role}`} key={`${index}-${message.role}`}>
          {message.role === "assistant" && <InvoAvatar size="message" />}
          <div className={`invo-message invo-${message.role}`}><strong>{message.role === "user" ? "You" : "Invo"}</strong><p>{message.content}</p></div>
        </div>)}
        {modeLink && <a className="invo-mode-link" href={wrongModeHref}>{target === "INVOICE" ? "Open Recurring Plan" : "Open New Invoice"}</a>}
        {pending && <p className="invo-thinking" role="status">Invo is thinking…</p>}
        {view.appliedMessage && <p className="invo-applied-note" role="status">{view.appliedMessage}</p>}
        {error && <div className="invo-error" role="alert"><span>{error}</span><button type="button" className="entry-text-button" onClick={retry} disabled={pending}>Try again</button></div>}
        {result?.state === "READY_PROPOSAL" && <ProposalReview target={target} result={result} onApply={applyProposal} onChangeDetails={changeDetails} />}
        {result?.state === "ASK_USER" && result.clientSuggestions.length > 0 && <div className="invo-suggestions">Possible clients: {result.clientSuggestions.map((client) => client.name).join(", ")}. Clarify the exact client in your reply.</div>}
        <div ref={conversationEnd} aria-hidden="true" />
      </div>
      <form className="invo-composer" onSubmit={submit}>
        <label className="invo-hidden-label" htmlFor={`invo-message-${target}`}>{target === "INVOICE" ? "Describe what to invoice" : "Describe the recurring billing plan"}</label>
        <textarea ref={textarea} id={`invo-message-${target}`} value={draft} maxLength={2000} rows={2} onChange={(event) => setDraft(event.target.value)} placeholder={target === "INVOICE" ? "Tell Invo what you want to invoice..." : "Tell Invo about the recurring billing plan..."} disabled={pending} />
        <button className="entry-button entry-button-primary" type="submit" disabled={pending || draft.trim().length < 3}>{pending ? "Sending…" : "Send"}</button>
      </form>
    </section>}
  </div>;
}

function InvoAvatar({ size }: { size: "trigger" | "header" | "message" }) {
  const dimensions = size === "trigger" ? 96 : size === "header" ? 48 : 30;
  const responsiveSize = size === "trigger" ? "(max-width: 600px) 64px, 88px" : `${dimensions}px`;
  return <Image className={`invo-avatar invo-avatar-${size}`} src={INVO_MASCOT_SRC} width={dimensions} height={dimensions} sizes={responsiveSize} alt="" aria-hidden="true" />;
}

function ProposalReview({ target, result, onApply, onChangeDetails }: {
  target: InvoTarget; result: InvoResult; onApply: (result: InvoResult) => void; onChangeDetails: () => void;
}) {
  return <div className="invo-review" aria-label="Proposal review">
    <div className="invo-review-title"><div><span>READY FOR REVIEW</span><h3>{target === "INVOICE" ? "Invoice draft proposal" : "Recurring plan proposal"}</h3></div><span className="invo-review-badge">Review required</span></div>
    <dl>
      {target === "RECURRING" && <Row label="Plan" value={result.proposal.planName ?? ""} />}
      <Row label="Client" value={result.resolvedClient?.name ?? result.proposal.clientHint ?? ""} />
      {result.proposal.projectTitle && <Row label="Project" value={result.proposal.projectTitle} />}
      <Row label="Currency" value={result.proposal.currencyCode ?? ""} />
      <div><dt>Items</dt><dd><ul>{result.proposal.items.map((item, index) => <li key={index}><strong>{item.description ?? item.serviceHint}</strong>{item.billingMode === "FLAT_FEE" ? ` — ${result.proposal.currencyCode} ${item.amount}` : ` — ${item.quantity} × ${result.proposal.currencyCode} ${item.unitPrice}`}{result.resolvedServices[index] ? <small>Service: {result.resolvedServices[index]?.name}</small> : null}</li>)}</ul></dd></div>
      {target === "RECURRING" ? <><Row label="Frequency" value={result.proposal.frequency === "YEARLY" ? "Yearly" : "Monthly"} /><Row label="First scheduled date" value={result.proposal.startDate ?? ""} />{result.proposal.dueInDays !== null && <Row label="Due in" value={`${result.proposal.dueInDays} days`} />}</> : <>{result.proposal.invoiceDate && <Row label="Invoice date" value={result.proposal.invoiceDate} />}{result.proposal.dueDate && <Row label="Due date" value={result.proposal.dueDate} />}{result.proposal.dueInDays !== null && <Row label="Due in" value={`${result.proposal.dueInDays} days`} />}</>}
      {result.proposal.discountAmount && result.proposal.discountAmount !== "0" && <Row label="Discount" value={`${result.proposal.discountLabel ?? "Fixed discount"}: ${result.proposal.currencyCode} ${result.proposal.discountAmount}`} />}
      {result.proposal.paymentTerms && <Row label="Payment terms" value={result.proposal.paymentTerms} />}
      {result.proposal.notes && <Row label="Notes" value={result.proposal.notes} />}
    </dl>
    <div className="invo-review-actions"><button className="entry-button entry-button-primary" type="button" onClick={() => onApply(result)}>Apply to {target === "INVOICE" ? "invoice" : "recurring"} form</button><button className="entry-button entry-button-light" type="button" onClick={onChangeDetails}>Change details</button></div>
  </div>;
}

function Row({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
