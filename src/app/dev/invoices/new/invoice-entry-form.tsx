"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  calculateInvoicePreview,
  DEFAULT_INVOICE_BILLING_MODE,
  currencyChangeWarningVisible,
  formatMoneyDisplay,
  itemHasMeaningfulContent,
  entryItemToPreviewItem,
  switchInvoiceItemBillingMode,
  normalizeMoneyInput,
  resolveServiceDefaultPrice,
  servicePriceGuidance,
  type InvoiceEntryItemState,
  type InvoiceDraftFormPayload,
} from "@/lib/invoices/invoice-entry-ui";
import { saveDraftAction, searchClientsAction, searchServicesAction } from "./actions";

type Client = { id: string; name: string; billingAddress: string | null; email: string | null; phone: string | null };
type Service = { id: string; name: string; description: string | null; defaultUnitPrice: string | null; currencyCode: string };
type Item = InvoiceEntryItemState & { key: string; serviceQuery: string };

const initialItem = (key = "item-0"): Item => ({ key, billingMode: DEFAULT_INVOICE_BILLING_MODE, serviceId: null, serviceQuery: "", description: "", quantity: "1", unitPrice: "", amount: "", useServiceDefaultPrice: false });

export function InvoiceEntryForm() {
  const [clientQuery, setClientQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientError, setClientError] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("LKR");
  const [originalCurrency, setOriginalCurrency] = useState("LKR");
  const [currencyChanged, setCurrencyChanged] = useState(false);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [items, setItems] = useState<Item[]>([initialItem()]);
  const nextItemKey = useRef(1);
  const [discountLabel, setDiscountLabel] = useState("");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [savedInvoiceId, setSavedInvoiceId] = useState("");
  const [isPending, startTransition] = useTransition();
  const preview = useMemo(() => calculateInvoicePreview(items.map(entryItemToPreviewItem), discountAmount), [items, discountAmount]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchClientsAction(clientQuery).then((result) => {
        if (cancelled) return;
        if (result.ok) { setClients(result.results); setClientError(""); }
        else { setClients([]); setClientError(result.error); }
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clientQuery]);

  function updateItem(key: string, patch: Partial<Item>) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function save() {
    setFormError("");
    if (!selectedClient) { setFormError("Choose a client before saving the draft."); return; }
    const payload: InvoiceDraftFormPayload = {
      clientId: selectedClient.id, projectTitle, invoiceDate, dueDate, currencyCode: currency,
      discountLabel, discountAmount, notes, paymentTerms,
      items: items.map((item) => item.billingMode === "FLAT_FEE"
        ? { billingMode: "FLAT_FEE" as const, serviceId: item.serviceId, description: item.description, amount: item.amount, useServiceDefaultPrice: item.useServiceDefaultPrice }
        : { billingMode: "QUANTITY" as const, serviceId: item.serviceId, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, useServiceDefaultPrice: item.useServiceDefaultPrice }),
    };
    startTransition(async () => {
      const result = await saveDraftAction(payload);
      if (result.ok) setSavedInvoiceId(result.invoiceId);
      else setFormError(result.error);
    });
  }

  function startAnotherDraft() {
    setSelectedClient(null); setClientQuery(""); setProjectTitle(""); setInvoiceDate(""); setDueDate("");
    setCurrency("LKR"); setOriginalCurrency("LKR"); setCurrencyChanged(false); setPaymentTerms("");
    setItems([initialItem()]); nextItemKey.current = 1; setDiscountLabel(""); setDiscountAmount("0"); setNotes("");
    setSavedInvoiceId(""); setFormError("");
  }

  return (
    <main className="entry-page">
      <div className="entry-dev-banner"><span className="entry-dev-dot" /> Development Invoice Entry <span>Development data only</span></div>
      <header className="entry-header">
        <div><div className="entry-eyebrow">INVOICES <span>/</span> NEW</div><div className="entry-title-row"><h1>Create Invoice</h1><span className="entry-status"><i /> Draft</span></div></div>
        <div className="entry-actions">
          <button className="entry-button entry-button-light" type="button" disabled title="Preview is not wired yet">Preview</button>
          <button className="entry-button entry-button-disabled" type="button" disabled title="Invoice issuance is not available in this task">Issue Invoice</button>
          <button className="entry-button entry-button-primary" type="button" onClick={save} disabled={isPending || Boolean(savedInvoiceId)}>{isPending ? "Saving…" : savedInvoiceId ? "Draft Saved" : "Save Draft"}</button>
        </div>
      </header>

      {savedInvoiceId && <div className="entry-success" role="status"><strong>Draft saved.</strong> Draft ID: <code>{savedInvoiceId}</code><button type="button" onClick={startAnotherDraft}>Create another draft</button></div>}
      {formError && <div className="entry-error" role="alert">{formError}</div>}

      <div className="entry-layout">
        <div className="entry-main-column">
          <section className="entry-card" aria-labelledby="client-heading">
            <div className="entry-section-heading"><span className="entry-step">01</span><div><h2 id="client-heading">Client</h2><p>Choose who this invoice is for.</p></div></div>
            <div className="entry-field entry-client-search"><label htmlFor="client-search">Search clients</label><input id="client-search" autoComplete="off" placeholder="Search by name, email, or phone" value={clientQuery} onChange={(event) => { setClientQuery(event.target.value); setSelectedClient(null); }} disabled={Boolean(savedInvoiceId)} />
              {!selectedClient && clientQuery && clients.length > 0 && <div className="entry-search-results" role="listbox" aria-label="Client search results">{clients.map((client) => <button type="button" role="option" aria-selected="false" key={client.id} onClick={() => { setSelectedClient(client); setClientQuery(client.name); }}>{client.name}<small>{client.email ?? client.phone ?? "Client"}</small></button>)}</div>}
              {clientError && <p className="entry-inline-error" role="alert">{clientError}</p>}
              {!selectedClient && !clientError && <p className="entry-hint">Type to search active clients in the development organization.</p>}
            </div>
            {selectedClient && <div className="entry-client-summary"><div className="entry-client-avatar">{selectedClient.name.slice(0, 1).toUpperCase()}</div><div><strong>{selectedClient.name}</strong><div>{selectedClient.billingAddress || "No billing address on file"}</div><div>{selectedClient.email || "No email"} <span>·</span> {selectedClient.phone || "No phone"}</div></div><button type="button" className="entry-text-button" onClick={() => { setSelectedClient(null); setClientQuery(""); }} disabled={Boolean(savedInvoiceId)}>Change</button></div>}
          </section>

          <section className="entry-card" aria-labelledby="details-heading">
            <div className="entry-section-heading"><span className="entry-step">02</span><div><h2 id="details-heading">Invoice details</h2><p>Set dates, currency, and project information.</p></div></div>
            <div className="entry-field-grid">
              <Field label="Project Title" id="project-title"><input id="project-title" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} placeholder="e.g. Website redesign" disabled={Boolean(savedInvoiceId)} /></Field>
              <Field label="Currency" id="currency"><input id="currency" list="invoice-currencies" value={currency} maxLength={3} onChange={(e) => { setCurrency(e.target.value.toUpperCase()); setCurrencyChanged(e.target.value.toUpperCase() !== originalCurrency); }} disabled={Boolean(savedInvoiceId)} /><datalist id="invoice-currencies">{["LKR", "USD", "CAD", "GBP", "EUR", "AUD"].map((code) => <option key={code} value={code} />)}</datalist><small>Use any three-letter currency code. Currency changes do not convert item prices.</small></Field>
              <Field label="Invoice Date" id="invoice-date"><input type="date" id="invoice-date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={Boolean(savedInvoiceId)} /></Field>
              <Field label="Due Date" id="due-date"><input type="date" id="due-date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={Boolean(savedInvoiceId)} /></Field>
              <Field label="Payment Terms" id="payment-terms"><input id="payment-terms" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Due within 14 days" disabled={Boolean(savedInvoiceId)} /></Field>
            </div>
            {currencyChangeWarningVisible(currencyChanged, items.filter(itemHasMeaningfulContent).length) && <p className="entry-currency-warning" role="status">Currency changed. Review item prices; amounts are not converted automatically.</p>}
          </section>

          <section className="entry-card entry-items-card" aria-labelledby="items-heading">
            <div className="entry-section-heading entry-items-heading"><span className="entry-step">03</span><div><h2 id="items-heading">Items</h2><p>Add a service or enter a custom line item.</p></div><button className="entry-button entry-button-light" type="button" onClick={() => setItems((current) => [...current, initialItem(`item-${nextItemKey.current++}`)])} disabled={Boolean(savedInvoiceId)}>＋ Add item</button></div>
            <div className="entry-item-list">
              {items.map((item, index) => <InvoiceItemRow key={item.key} item={item} index={index} count={items.length} currency={currency} disabled={Boolean(savedInvoiceId)} onChange={(patch) => updateItem(item.key, patch)} onRemove={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))} onMove={(direction) => setItems((current) => { const next = [...current]; const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target]!, next[index]!]; return next; })} amount={preview.amountFor(entryItemToPreviewItem(item))} />)}
            </div>
            {items.length === 0 && <p className="entry-empty-items">No items yet. Add an item to begin.</p>}
          </section>

          <section className="entry-card" aria-labelledby="notes-heading">
            <div className="entry-section-heading"><span className="entry-step">04</span><div><h2 id="notes-heading">Notes</h2><p>Optional details for this invoice.</p></div></div>
            <Field label="Notes" id="invoice-notes"><textarea id="invoice-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for your records or your client…" disabled={Boolean(savedInvoiceId)} /></Field>
          </section>
        </div>

        <aside className="entry-summary" aria-label="Invoice totals preview">
          <div className="entry-summary-title"><div><span>LIVE PREVIEW</span><h2>Summary</h2></div><span className="entry-status"><i /> Draft</span></div>
          <Field label="Discount Label" id="discount-label"><input id="discount-label" value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} placeholder="e.g. Courtesy discount" disabled={Boolean(savedInvoiceId)} /></Field>
          <Field label={`Discount Amount (${currency})`} id="discount-amount"><MoneyInput id="discount-amount" value={discountAmount} onChange={setDiscountAmount} aria-invalid={!preview.discountValid} aria-describedby={!preview.discountValid ? "discount-error" : undefined} placeholder="0.00" disabled={Boolean(savedInvoiceId)} /></Field>
          {!preview.discountValid && <p id="discount-error" className="entry-inline-error" role="alert">Enter a non-negative discount with no more than four decimal places.</p>}
          <div className="entry-total-line"><span>Subtotal</span><strong>{currency} {formatMoneyDisplay(preview.subtotal)}</strong></div>
          <div className="entry-total-line"><span>Discount</span><strong>− {currency} {formatMoneyDisplay(preview.discount)}</strong></div>
          <div className="entry-total-payable"><span>Amount payable</span><strong>{currency} {formatMoneyDisplay(preview.payable)}</strong></div>
          <p className="entry-preview-note">Preview only. Final totals are calculated and validated when saved.</p>
          <button className="entry-button entry-button-primary entry-summary-save" type="button" onClick={save} disabled={isPending || Boolean(savedInvoiceId)}>{isPending ? "Saving…" : savedInvoiceId ? "Draft Saved" : "Save Draft"}</button>
          <button className="entry-issue-disabled" type="button" disabled>Issue Invoice <span>Unavailable</span></button>
        </aside>
      </div>
      <footer className="entry-footer"><span>Development entry only</span><span>Invoice totals are confirmed by the server on save.</span></footer>
    </main>
  );
}

function InvoiceItemRow({ item, index, count, currency, disabled, onChange, onRemove, onMove, amount }: {
  item: Item; index: number; count: number; currency: string; disabled: boolean;
  onChange: (patch: Partial<Item>) => void; onRemove: () => void; onMove: (direction: number) => void; amount: string;
}) {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceError, setServiceError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchServicesAction(item.serviceQuery).then((result) => {
        if (cancelled) return;
        if (result.ok) { setServices(result.results); setServiceError(""); }
        else { setServices([]); setServiceError(result.error); }
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [item.serviceQuery]);
  const selectedService = services.find((service) => service.id === item.serviceId);
  const mismatch = selectedService && servicePriceGuidance(selectedService.currencyCode, currency);

  function chooseService(service: Service) {
    onChange({
      serviceId: service.id,
      serviceQuery: service.name,
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
      <input id={`service-${item.key}`} autoComplete="off" value={item.serviceQuery} placeholder="Search a service or leave blank" onChange={(e) => onChange({ serviceId: null, serviceQuery: e.target.value, useServiceDefaultPrice: false })} disabled={disabled} />
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
    <div className="entry-item-controls"><span className="entry-item-order">{String(index + 1).padStart(2, "0")}</span><button type="button" aria-label={`Move item ${index + 1} up`} onClick={() => onMove(-1)} disabled={disabled || index === 0}>↑</button><button type="button" aria-label={`Move item ${index + 1} down`} onClick={() => onMove(1)} disabled={disabled || index === count - 1}>↓</button><button type="button" aria-label={`Remove item ${index + 1}`} className="entry-remove-button" onClick={onRemove} disabled={disabled}>×</button></div>
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
