"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IssueInvoiceControl } from "./issue-invoice-control";
import { InvoAssistant } from "./invo-assistant";
import {
  calculateInvoicePreview,
  DEFAULT_INVOICE_BILLING_MODE,
  currencyChangeWarningVisible,
  formatMoneyDisplay,
  itemHasMeaningfulContent,
  hasMeaningfulDraftAutosaveThreshold,
  entryItemToPreviewItem,
  mapDraftInvoiceToEntryInitialState,
  switchInvoiceItemBillingMode,
  normalizeMoneyInput,
  resolveServiceDefaultPrice,
  servicePriceGuidance,
  type InvoiceEntryItemState,
  type InvoiceDraftFormPayload,
  type InvoiceEntryDraftData,
  type InvoiceEntryServiceDisplay,
} from "@/lib/invoices/invoice-entry-ui";
import { runSingleFlight } from "@/lib/invoices/autosave-single-flight";
import type { InvoActionResult, InvoMessage, InvoResult, InvoTarget } from "@/lib/ai/invo-contract";

type Client = { id: string; name: string; billingAddress: string | null; email: string | null; phone: string | null; active?: boolean };
type Service = InvoiceEntryServiceDisplay;
type Item = InvoiceEntryItemState & { key: string; position?: number; serviceQuery: string; selectedService: Service | null };
type SearchActionResult<T> = { ok: true; results: T[] } | { ok: false; error: string };
type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
export type InvoiceEntryFormActions = {
  searchClients: (query: string) => Promise<SearchActionResult<Client>>;
  searchServices: (query: string) => Promise<SearchActionResult<Service>>;
  saveDraft?: (value: unknown) => Promise<ActionResult<{ invoiceId: string }>>;
  saveDraftChanges?: (invoiceId: string, value: unknown) => Promise<ActionResult>;
  issueInvoice?: (invoiceId?: string) => Promise<{ ok: true; invoiceId: string; invoiceNumber: string } | { ok: false; error: string }>;
  invo?: (target: InvoTarget, messages: readonly InvoMessage[], offers: readonly string[]) => Promise<InvoActionResult>;
};
export type InvoiceEntryPresentation = {
  mode: "development" | "production";
  organizationName?: string;
  userLabel?: string;
  role?: string;
  editBasePath: string;
  previewHref?: string;
};

const initialItem = (key = "item-0"): Item => ({ key, billingMode: DEFAULT_INVOICE_BILLING_MODE, serviceId: null, serviceQuery: "", selectedService: null, description: "", quantity: "1", unitPrice: "", amount: "", useServiceDefaultPrice: false });

export function InvoiceEntryForm({ invoiceId, initialDraft, actions, presentation, workspaceHeader }: {
  invoiceId?: string;
  initialDraft?: InvoiceEntryDraftData;
  actions: InvoiceEntryFormActions;
  presentation: InvoiceEntryPresentation;
  workspaceHeader?: ReactNode;
}) {
  const editing = Boolean(invoiceId && initialDraft);
  const draftState = initialDraft ? mapDraftInvoiceToEntryInitialState(initialDraft) : null;
  const [clientQuery, setClientQuery] = useState(draftState?.clientQuery ?? "");
  const [clients, setClients] = useState<Client[]>(draftState?.selectedClient ? [draftState.selectedClient] : []);
  const [selectedClient, setSelectedClient] = useState<Client | null>(draftState?.selectedClient ?? null);
  const [clientError, setClientError] = useState("");
  const [projectTitle, setProjectTitle] = useState(draftState?.projectTitle ?? "");
  const [invoiceDate, setInvoiceDate] = useState(draftState?.invoiceDate ?? "");
  const [dueDate, setDueDate] = useState(draftState?.dueDate ?? "");
  const [currency, setCurrency] = useState(draftState?.currency ?? "LKR");
  const [originalCurrency, setOriginalCurrency] = useState(draftState?.originalCurrency ?? "LKR");
  const [currencyChanged, setCurrencyChanged] = useState<boolean>(draftState?.currencyChanged ?? false);
  const [paymentTerms, setPaymentTerms] = useState(draftState?.paymentTerms ?? "");
  const [items, setItems] = useState<Item[]>(() => draftState ? draftState.items.map((item) => ({ ...item })) : [initialItem()]);
  const nextItemKey = useRef(draftState?.items.length ?? 1);
  const [discountLabel, setDiscountLabel] = useState(draftState?.discountLabel ?? "");
  const [discountAmount, setDiscountAmount] = useState(draftState?.discountAmount ?? "0");
  const [notes, setNotes] = useState(draftState?.notes ?? "");
  const [formError, setFormError] = useState("");
  const [savedInvoiceId, setSavedInvoiceId] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const [saveState, setSaveState] = useState<"NOT_SAVED" | "SAVING" | "SAVED" | "FAILED">(editing ? "SAVED" : "NOT_SAVED");
  const router = useRouter();
  const revisionRef = useRef(0);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const latestPayloadRef = useRef<InvoiceDraftFormPayload | null>(null);
  const latestRevisionRef = useRef(0);
  const invoiceIdRef = useRef(invoiceId ?? "");
  const searchClients = actions.searchClients;
  const searchServices = actions.searchServices;
  const lockCreatedDraft = presentation.mode === "development" && Boolean(savedInvoiceId) && !editing;
  const preview = useMemo(() => calculateInvoicePreview(items.map(entryItemToPreviewItem), discountAmount), [items, discountAmount]);

  const buildPayload = (): InvoiceDraftFormPayload | null => selectedClient ? ({
    clientId: selectedClient.id, projectTitle, invoiceDate, dueDate, currencyCode: currency,
    discountLabel, discountAmount, notes, paymentTerms,
    items: items.map((item) => item.billingMode === "FLAT_FEE"
      ? { billingMode: "FLAT_FEE" as const, serviceId: item.serviceId, description: item.description, amount: item.amount, useServiceDefaultPrice: item.useServiceDefaultPrice }
      : { billingMode: "QUANTITY" as const, serviceId: item.serviceId, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, useServiceDefaultPrice: item.useServiceDefaultPrice }),
  }) : null;
  latestPayloadRef.current = buildPayload();
  latestRevisionRef.current = revisionRef.current;

  function markFormDirty() { revisionRef.current += 1; setFormDirty(true); }

  function saveLatest(): Promise<boolean> {
    return runSingleFlight(savingRef, async () => {
      while (true) {
        const payload = latestPayloadRef.current;
        const revision = latestRevisionRef.current;
        if (!payload) { setSaveState("FAILED"); setFormError("Choose a client before saving the draft."); return false; }
        setSaveState("SAVING");
        let result: ActionResult<{ invoiceId?: string }>;
        const id = invoiceIdRef.current || savedInvoiceId;
        try {
          if (id) {
            if (!actions.saveDraftChanges) { setFormError("Draft editing is unavailable."); setSaveState("FAILED"); return false; }
            result = await actions.saveDraftChanges(id, payload);
          } else {
            if (!actions.saveDraft) { setFormError("Draft creation is unavailable."); setSaveState("FAILED"); return false; }
            result = await actions.saveDraft(payload);
          }
        } catch {
          setFormError("Could not save this draft. Your changes are still here; retry with Save now."); setSaveState("FAILED"); return false;
        }
        if (!result.ok) { setFormError(result.error); setSaveState("FAILED"); return false; }
        setFormError("");
        if (!id) {
          if (!result.invoiceId) { setFormError("Draft was saved without an identifier. Retry from the invoice workspace."); setSaveState("FAILED"); return false; }
          invoiceIdRef.current = result.invoiceId;
          setSavedInvoiceId(result.invoiceId);
          const route = `${presentation.editBasePath}/${encodeURIComponent(result.invoiceId)}/edit`;
          if (presentation.mode === "production") window.history.replaceState(null, "", route);
        }
        if (latestRevisionRef.current !== revision) continue;
        setFormDirty(false); setSaveState("SAVED");
        return true;
      }
    });
  }

  function meaningfulAutosaveThreshold(): boolean {
    return hasMeaningfulDraftAutosaveThreshold(Boolean(selectedClient?.active !== false && selectedClient), currency, items);
  }

  useEffect(() => {
    if (presentation.mode !== "production" || !formDirty) return;
    if (!invoiceIdRef.current && !meaningfulAutosaveThreshold()) { setSaveState("NOT_SAVED"); return; }
    const timer = setTimeout(() => { void saveLatest(); }, 950);
    return () => clearTimeout(timer);
    // Save state uses the latest payload/revision refs; form values are explicit dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation.mode, formDirty, clientQuery, selectedClient, projectTitle, invoiceDate, dueDate, currency, paymentTerms, items, discountLabel, discountAmount, notes]);

  useEffect(() => {
    if (presentation.mode !== "production" || !(invoiceIdRef.current || savedInvoiceId) || !(formDirty || saveState === "FAILED" || saveState === "SAVING")) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [presentation.mode, savedInvoiceId, formDirty, saveState]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchClients(clientQuery).then((result) => {
        if (cancelled) return;
        if (result.ok) { setClients(result.results); setClientError(""); }
        else { setClients([]); setClientError(result.error); }
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchClients, clientQuery]);

  function updateItem(key: string, patch: Partial<Item>) {
    markFormDirty();
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function startAnotherDraft() {
    setSelectedClient(null); setClientQuery(""); setProjectTitle(""); setInvoiceDate(""); setDueDate("");
    setCurrency("LKR"); setOriginalCurrency("LKR"); setCurrencyChanged(false); setPaymentTerms("");
    setItems([initialItem()]); nextItemKey.current = 1; setDiscountLabel(""); setDiscountAmount("0"); setNotes("");
    setSavedInvoiceId(""); invoiceIdRef.current = ""; revisionRef.current = 0; setSaveState("NOT_SAVED"); setFormDirty(false); setFormError("");
  }

  function applyInvo(result: InvoResult) {
    const proposal = result.proposal;
    const selectedClient = result.resolvedClient ? { id: result.resolvedClient.id, name: result.resolvedClient.name, billingAddress: null, email: null, phone: null, active: true } : null;
    setClientQuery(selectedClient?.name ?? proposal.clientHint ?? "");
    setClients(selectedClient ? [selectedClient] : []);
    setSelectedClient(selectedClient);
    setClientError("");
    setProjectTitle(proposal.projectTitle ?? "");
    setInvoiceDate(proposal.invoiceDate ?? "");
    setDueDate(proposal.dueDate ?? (proposal.dueInDays === null ? "" : addCalendarDays(proposal.invoiceDate ?? currentColomboDate(), proposal.dueInDays)));
    setCurrency(proposal.currencyCode ?? "");
    setOriginalCurrency("LKR");
    setCurrencyChanged(proposal.currencyCode !== "LKR");
    setPaymentTerms(proposal.paymentTerms ?? "");
    const items: Item[] = proposal.items.map((item, index) => ({
      key: `invo-${Date.now()}-${index}`, position: index, billingMode: item.billingMode,
      serviceId: result.resolvedServices[index]?.id ?? null, serviceQuery: result.resolvedServices[index]?.name ?? item.serviceHint ?? "", selectedService: null,
      description: item.description ?? item.serviceHint ?? "", quantity: item.billingMode === "QUANTITY" ? item.quantity ?? "" : "1",
      unitPrice: item.billingMode === "QUANTITY" ? item.unitPrice ?? "" : "", amount: item.billingMode === "FLAT_FEE" ? item.amount ?? "" : "", useServiceDefaultPrice: false,
    }));
    setItems(items.length ? items : [initialItem()]);
    nextItemKey.current = items.length;
    setDiscountLabel(proposal.discountLabel ?? "");
    setDiscountAmount(proposal.discountAmount ?? "0");
    setNotes(proposal.notes ?? "");
    markFormDirty();
    setFormError("");
  }

  const persistedInvoiceId = invoiceIdRef.current || savedInvoiceId || invoiceId || "";
  const canIssue = Boolean(persistedInvoiceId && actions.issueInvoice && saveState === "SAVED" && !formDirty);
  async function openPreview() {
    if (!persistedInvoiceId && !meaningfulAutosaveThreshold()) return;
    if (formDirty || saveState !== "SAVED") {
      if (!await saveLatest()) return;
    }
    const id = invoiceIdRef.current || savedInvoiceId || invoiceId;
    if (id) router.push(`${presentation.editBasePath}/${encodeURIComponent(id)}/preview`);
  }
  function guardNavigation(event: React.MouseEvent<HTMLElement>) {
    if (presentation.mode !== "production" || !(invoiceIdRef.current || savedInvoiceId) || !(formDirty || saveState === "FAILED" || saveState === "SAVING")) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("a[href]")) return;
    if (!window.confirm("This draft has changes that are not saved yet. Leave this page?")) event.preventDefault();
  }

  return (
    <main className={`entry-page${presentation.mode === "production" ? " entry-page-production" : ""}`} onChange={markFormDirty} onClickCapture={guardNavigation}>
      {presentation.mode === "development" ? <div className="entry-dev-banner"><span className="entry-dev-dot" /> Development Invoice Entry <span>Development data only</span></div> : workspaceHeader}
      <header className="entry-header">
        <div><div className="entry-eyebrow"><Link href={presentation.editBasePath}>INVOICES</Link> <span>/</span> {editing ? "EDIT DRAFT" : "NEW"}</div><div className="entry-title-row"><h1>{editing ? "Edit Invoice" : "Create Invoice"}</h1><span className="entry-status"><i /> Draft</span></div></div>
        <div className="entry-actions">
          {presentation.mode === "production" && <span className="entry-save-status" role="status">{saveState === "NOT_SAVED" ? "Not saved yet" : saveState === "SAVING" ? "Saving…" : saveState === "FAILED" ? "Save failed" : "Saved"}</span>}
          {presentation.mode === "production" && (persistedInvoiceId || meaningfulAutosaveThreshold()) ? <button className="entry-button entry-button-light" type="button" onClick={() => void openPreview()}>Preview</button> : <button className="entry-button entry-button-light" type="button" disabled title="Save the draft in the production workspace before previewing">Preview</button>}
          {actions.issueInvoice && persistedInvoiceId ? <IssueInvoiceControl issue={actions.issueInvoice} invoiceBasePath={presentation.editBasePath} invoiceId={persistedInvoiceId} beforeIssue={saveLatest} disabled={!canIssue} /> : <button className="entry-button entry-button-disabled" type="button" disabled title="A saved draft that meets issue requirements is required">Issue Invoice</button>}
          <button className="entry-button entry-button-light" type="button" onClick={() => { setFormError(""); void saveLatest(); }} disabled={saveState === "SAVING" || (!editing && !savedInvoiceId && !meaningfulAutosaveThreshold())}>Save now</button>
        </div>
      </header>

      {presentation.mode === "development" && savedInvoiceId && <div className="entry-success" role="status"><strong>Draft saved.</strong> Draft ID: <code>{savedInvoiceId}</code><button type="button" onClick={startAnotherDraft}>Create another draft</button></div>}
      {formError && <div className="entry-error" role="alert">{formError}</div>}

      {presentation.mode === "production" && !editing && !savedInvoiceId && actions.invo && <InvoAssistant target="INVOICE" send={actions.invo} onApply={applyInvo} wrongModeHref={`${presentation.editBasePath.replace(/\/invoices$/, "")}/recurring/new`} />}

      <div className="entry-layout">
        <div className="entry-main-column">
          <section className="entry-card" aria-labelledby="client-heading">
            <div className="entry-section-heading"><span className="entry-step">01</span><div><h2 id="client-heading">Client</h2><p>Choose who this invoice is for.</p></div></div>
            <div className="entry-field entry-client-search"><label htmlFor="client-search">Search clients</label><input id="client-search" autoComplete="off" placeholder="Search by name, email, or phone" value={clientQuery} onChange={(event) => { setClientQuery(event.target.value); setSelectedClient(null); }} disabled={lockCreatedDraft} />
              {!selectedClient && clientQuery && clients.length > 0 && <div className="entry-search-results" role="listbox" aria-label="Client search results">{clients.map((client) => <button type="button" role="option" aria-selected="false" key={client.id} onClick={() => { markFormDirty(); setSelectedClient(client); setClientQuery(client.name); }}>{client.name}<small>{client.email ?? client.phone ?? "Client"}</small></button>)}</div>}
              {clientError && <p className="entry-inline-error" role="alert">{clientError}</p>}
              {!selectedClient && !clientError && <p className="entry-hint">Type to search active clients in {presentation.mode === "development" ? "the development organization" : presentation.organizationName}.</p>}
            </div>
            {selectedClient && <div className="entry-client-summary"><div className="entry-client-avatar">{selectedClient.name.slice(0, 1).toUpperCase()}</div><div><strong>{selectedClient.name}</strong><div>{selectedClient.billingAddress || "No billing address on file"}</div><div>{selectedClient.email || "No email"} <span>·</span> {selectedClient.phone || "No phone"}</div>{selectedClient.active === false && <small className="entry-inline-error">This client is inactive. Choose an active client before saving.</small>}</div><button type="button" className="entry-text-button" onClick={() => { markFormDirty(); setSelectedClient(null); setClientQuery(""); }} disabled={lockCreatedDraft}>Change</button></div>}
          </section>

          <section className="entry-card" aria-labelledby="details-heading">
            <div className="entry-section-heading"><span className="entry-step">02</span><div><h2 id="details-heading">Invoice details</h2><p>Set dates, currency, and project information.</p></div></div>
            <div className="entry-field-grid">
              <Field label="Project Title" id="project-title"><input id="project-title" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} placeholder="e.g. Website redesign" disabled={lockCreatedDraft} /></Field>
              <Field label="Currency" id="currency"><input id="currency" list="invoice-currencies" value={currency} maxLength={3} onChange={(e) => { setCurrency(e.target.value.toUpperCase()); setCurrencyChanged(e.target.value.toUpperCase() !== originalCurrency); }} disabled={lockCreatedDraft} /><datalist id="invoice-currencies">{["LKR", "USD", "CAD", "GBP", "EUR", "AUD"].map((code) => <option key={code} value={code} />)}</datalist><small>Use any three-letter currency code. Currency changes do not convert item prices.</small></Field>
              <Field label="Invoice Date" id="invoice-date"><input type="date" id="invoice-date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={lockCreatedDraft} /></Field>
              <Field label="Due Date" id="due-date"><input type="date" id="due-date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={lockCreatedDraft} /></Field>
              <Field label="Payment Terms" id="payment-terms"><input id="payment-terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Due within 14 days" disabled={lockCreatedDraft} /></Field>
            </div>
            {currencyChangeWarningVisible(currencyChanged, items.filter(itemHasMeaningfulContent).length) && <p className="entry-currency-warning" role="status">Currency changed. Review item prices; amounts are not converted automatically.</p>}
          </section>

          <section className="entry-card entry-items-card" aria-labelledby="items-heading">
            <div className="entry-section-heading entry-items-heading"><span className="entry-step">03</span><div><h2 id="items-heading">Items</h2><p>Add a service or enter a custom line item.</p></div><button className="entry-button entry-button-light" type="button" onClick={() => { markFormDirty(); setItems((current) => [...current, initialItem(`item-${nextItemKey.current++}`)]); }} disabled={lockCreatedDraft}>＋ Add item</button></div>
            <div className="entry-item-list">
              {items.map((item, index) => <InvoiceItemRow key={item.key} item={item} index={index} count={items.length} currency={currency} disabled={lockCreatedDraft} searchServices={searchServices} onChange={(patch) => updateItem(item.key, patch)} onRemove={() => { markFormDirty(); setItems((current) => current.filter((candidate) => candidate.key !== item.key)); }} onMove={(direction) => { markFormDirty(); setItems((current) => { const next = [...current]; const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index]!, next[target]!] = [next[target]!, next[index]!]; return next; }); }} amount={preview.amountFor(entryItemToPreviewItem(item))} />)}
            </div>
            {items.length === 0 && <p className="entry-empty-items">No items yet. Add an item to begin.</p>}
          </section>

          <section className="entry-card" aria-labelledby="notes-heading">
            <div className="entry-section-heading"><span className="entry-step">04</span><div><h2 id="notes-heading">Notes</h2><p>Optional details for this invoice.</p></div></div>
            <Field label="Notes" id="invoice-notes"><textarea id="invoice-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for your records or your client…" disabled={lockCreatedDraft} /></Field>
          </section>
        </div>

        <aside className="entry-summary" aria-label="Invoice totals preview">
          <div className="entry-summary-title"><div><span>LIVE PREVIEW</span><h2>Summary</h2></div><span className="entry-status"><i /> Draft</span></div>
          <Field label="Discount Label" id="discount-label"><input id="discount-label" value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} placeholder="e.g. Courtesy discount" disabled={lockCreatedDraft} /></Field>
          <Field label={`Discount Amount (${currency})`} id="discount-amount"><MoneyInput id="discount-amount" value={discountAmount} onChange={setDiscountAmount} aria-invalid={!preview.discountValid} aria-describedby={!preview.discountValid ? "discount-error" : undefined} placeholder="0.00" disabled={lockCreatedDraft} /></Field>
          {!preview.discountValid && <p id="discount-error" className="entry-inline-error" role="alert">Enter a non-negative discount with no more than four decimal places.</p>}
          <div className="entry-total-line"><span>Subtotal</span><strong>{currency} {formatMoneyDisplay(preview.subtotal)}</strong></div>
          <div className="entry-total-line"><span>Discount</span><strong>− {currency} {formatMoneyDisplay(preview.discount)}</strong></div>
          <div className="entry-total-payable"><span>Amount payable</span><strong>{currency} {formatMoneyDisplay(preview.payable)}</strong></div>
          <p className="entry-preview-note">Preview only. Final totals are calculated and validated when saved.</p>
        </aside>
      </div>
      <footer className="entry-footer">{presentation.mode === "development" && <span>Development entry only</span>}<span>Invoice totals are confirmed by the server on save.</span></footer>
    </main>
  );
}

function currentColomboDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isSafeInteger(days) || days < 0) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function InvoiceItemRow({ item, index, count, currency, disabled, searchServices, onChange, onRemove, onMove, amount }: {
  item: Item; index: number; count: number; currency: string; disabled: boolean;
  searchServices: InvoiceEntryFormActions["searchServices"];
  onChange: (patch: Partial<Item>) => void; onRemove: () => void; onMove: (direction: number) => void; amount: string;
}) {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceError, setServiceError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchServices(item.serviceQuery).then((result) => {
        if (cancelled) return;
        const savedService = item.selectedService;
        if (result.ok) {
          setServices([...(savedService ? [savedService] : []), ...result.results.filter((service) => service.id !== savedService?.id)]);
          setServiceError("");
        } else {
          setServices(savedService ? [savedService] : []);
          setServiceError(result.error);
        }
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [item.serviceQuery, item.selectedService, searchServices]);
  const selectedService = services.find((service) => service.id === item.serviceId);
  const mismatch = selectedService && servicePriceGuidance(selectedService.currencyCode, currency);

  function chooseService(service: Service) {
    onChange({
      serviceId: service.id,
      serviceQuery: service.name,
      selectedService: service,
      description: item.description || service.description || service.name,
      useServiceDefaultPrice: false,
    });
  }

  const defaultPrice = selectedService?.defaultUnitPrice
    ? resolveServiceDefaultPrice("", selectedService.defaultUnitPrice, selectedService.currencyCode, currency)
    : "";
  const canUseDefault = Boolean(selectedService && defaultPrice && (item.billingMode === "FLAT_FEE" ? item.amount : item.unitPrice).trim() === "");
  function useDefaultPrice() {
    if (!defaultPrice) return;
    onChange(item.billingMode === "FLAT_FEE"
      ? { amount: defaultPrice, useServiceDefaultPrice: true }
      : { unitPrice: defaultPrice, useServiceDefaultPrice: true });
  }

  return <div className={`entry-item-row${item.billingMode === "FLAT_FEE" ? " entry-item-row-flat" : ""}`}>
    <fieldset className="entry-item-mode">
      <legend>Billing method</legend>
      <label><input type="radio" name={`billing-mode-${item.key}`} value="FLAT_FEE" checked={item.billingMode === "FLAT_FEE"} onChange={() => onChange(switchInvoiceItemBillingMode(item, "FLAT_FEE"))} disabled={disabled} /><span>Flat fee</span></label>
      <label><input type="radio" name={`billing-mode-${item.key}`} value="QUANTITY" checked={item.billingMode === "QUANTITY"} onChange={() => onChange(switchInvoiceItemBillingMode(item, "QUANTITY"))} disabled={disabled} /><span>Quantity × unit price</span></label>
    </fieldset>
    <div className="entry-item-service">
      <label htmlFor={`service-${item.key}`}>Service <span className="entry-optional">optional</span></label>
      <input id={`service-${item.key}`} autoComplete="off" value={item.serviceQuery} placeholder="Search a service or leave blank" onChange={(e) => onChange({ serviceId: null, selectedService: null, serviceQuery: e.target.value, useServiceDefaultPrice: false })} disabled={disabled} />
      {item.serviceQuery && !item.serviceId && services.length > 0 && <div className="entry-search-results entry-service-results" role="listbox" aria-label="Service search results">{services.map((service) => <button type="button" role="option" aria-selected="false" key={service.id} onClick={() => chooseService(service)}>{service.name}<small>{service.defaultUnitPrice === null ? "No default price" : `${service.currencyCode} ${formatMoneyDisplay(service.defaultUnitPrice)} default`}</small></button>)}</div>}
      {serviceError && <small className="entry-inline-error">{serviceError}</small>}
      <label htmlFor={`description-${item.key}`}>Description</label>
      <input id={`description-${item.key}`} value={item.description} placeholder="Describe this item" onChange={(e) => onChange({ description: e.target.value })} disabled={disabled} />
      {selectedService && <small className="entry-hint">{selectedService.defaultUnitPrice === null ? "No default price set for this service." : `Default price: ${selectedService.currencyCode} ${formatMoneyDisplay(selectedService.defaultUnitPrice)}`}</small>}
      {canUseDefault && <button className="entry-use-default" type="button" onClick={useDefaultPrice} disabled={disabled}>Use {selectedService?.currencyCode} {formatMoneyDisplay(defaultPrice)} service default</button>}
      {mismatch && <small className="entry-currency-warning entry-service-warning">{mismatch}</small>}
    </div>
    {item.billingMode === "QUANTITY" ? <>
      <div className="entry-item-quantity"><label htmlFor={`quantity-${item.key}`}>Quantity</label><input id={`quantity-${item.key}`} inputMode="decimal" value={item.quantity} onChange={(e) => onChange({ quantity: e.target.value, useServiceDefaultPrice: false })} disabled={disabled} /></div>
      <div className="entry-item-price"><label htmlFor={`price-${item.key}`}>Unit Price ({currency})</label><MoneyInput id={`price-${item.key}`} value={item.unitPrice} onChange={(value) => onChange({ unitPrice: value, useServiceDefaultPrice: false })} placeholder="0.00" disabled={disabled} /></div>
    </> : <div className="entry-item-price entry-item-flat-amount"><label htmlFor={`amount-${item.key}`}>Amount ({currency})</label><MoneyInput id={`amount-${item.key}`} value={item.amount} onChange={(value) => onChange({ amount: value, useServiceDefaultPrice: false })} placeholder="0.00" disabled={disabled} /></div>}
    <div className="entry-item-amount"><span>Amount</span><strong>{amount === "—" ? amount : `${currency} ${formatMoneyDisplay(amount)}`}</strong></div>
    <div className="entry-item-controls"><span className="entry-item-order">{String(index + 1).padStart(2, "0")}</span><button type="button" aria-label={`Move item ${index + 1} up`} title="Move up" onClick={() => onMove(-1)} disabled={disabled || index === 0}>↑</button><button type="button" aria-label={`Move item ${index + 1} down`} title="Move down" onClick={() => onMove(1)} disabled={disabled || index === count - 1}>↓</button><button type="button" aria-label={`Remove item ${index + 1}`} title="Remove item" className="entry-remove-button" onClick={onRemove} disabled={disabled}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m3 0-.7 10H5.7L5 6m3 3v4m4-4v4" /></svg></button></div>
  </div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="entry-field"><label htmlFor={id}>{label}</label>{children}</div>;
}

function MoneyInput({ id, value, onChange, disabled, placeholder, ...accessibility }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean; placeholder?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "defaultValue" | "onChange" | "disabled" | "placeholder" | "inputMode">) {
  const [focused, setFocused] = useState(false);
  return <input
    id={id}
    inputMode="decimal"
    value={focused ? value : formatMoneyDisplay(value)}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    onChange={(event) => onChange(normalizeMoneyInput(event.target.value))}
    disabled={disabled}
    placeholder={placeholder}
    {...accessibility}
  />;
}
