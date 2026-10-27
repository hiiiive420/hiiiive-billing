"use client";

import { useActionState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { createClientAction, createClientContactAction, updateClientAction, updateClientContactAction } from "@/app/app/[organizationSlug]/clients/actions";
import { createServiceAction, updateServiceAction } from "@/app/app/[organizationSlug]/services/actions";

export type MasterDataActionState = { error?: string; success?: string; entityId?: string };
const initialState: MasterDataActionState = {};

export function ClientForm({ organizationSlug, client }: { organizationSlug: string; client?: { id: string; name: string; businessRegistrationOrTaxIdentifier: string | null; phone: string | null; email: string | null; billingAddress: string | null; notes: string | null; active: boolean } }) {
  const router = useRouter();
  const action = client ? updateClientAction.bind(null, organizationSlug, client.id) : createClientAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(action, initialState);
  useEffect(() => {
    if (state.entityId) router.replace(`/app/${encodeURIComponent(organizationSlug)}/clients/${encodeURIComponent(state.entityId)}`);
    else if (state.success) router.refresh();
  }, [organizationSlug, router, state.entityId, state.success]);
  return <form action={formAction} className="entry-card master-data-form">
    <div className="entry-section-heading"><div><h2>{client ? "Client details" : "Client details"}</h2><p>Used by future invoice drafts. Issued invoices keep their saved client details.</p></div></div>
    <div className="master-data-fields">
      <Field label="Client name" name="name" required defaultValue={client?.name ?? ""} maxLength={200} />
      <Field label="Email" name="email" type="email" defaultValue={client?.email ?? ""} maxLength={254} />
      <Field label="Phone" name="phone" defaultValue={client?.phone ?? ""} maxLength={50} />
      <Field label="Business registration / tax identifier" name="businessRegistrationOrTaxIdentifier" defaultValue={client?.businessRegistrationOrTaxIdentifier ?? ""} maxLength={200} />
      <Field label="Billing address" name="billingAddress" multiline defaultValue={client?.billingAddress ?? ""} maxLength={2000} />
      <Field label="Internal notes" name="notes" multiline defaultValue={client?.notes ?? ""} maxLength={5000} />
      {client && <label className="master-data-check"><input type="checkbox" name="active" defaultChecked={client.active} /> Active client</label>}
    </div>
    <FormMessage state={state} />
    <div className="master-data-form-actions"><button className="entry-button entry-button-primary" disabled={pending}>{pending ? "Saving…" : client ? "Save Client" : "Create Client"}</button></div>
  </form>;
}

export function ClientContactForm({ organizationSlug, clientId, contact }: { organizationSlug: string; clientId: string; contact?: { id: string; name: string; email: string | null; phone: string | null; billingContact: boolean; primaryContact: boolean; active: boolean } }) {
  const router = useRouter();
  const action = contact
    ? updateClientContactAction.bind(null, organizationSlug, clientId, contact.id)
    : createClientContactAction.bind(null, organizationSlug, clientId);
  const [state, formAction, pending] = useActionState(action, initialState);
  useEffect(() => { if (state.success) router.refresh(); }, [router, state.success]);
  return <form action={formAction} className="master-contact-form">
    <Field label="Contact name" name="name" required defaultValue={contact?.name ?? ""} maxLength={200} />
    <Field label="Email" name="email" type="email" defaultValue={contact?.email ?? ""} maxLength={254} />
    <Field label="Phone" name="phone" defaultValue={contact?.phone ?? ""} maxLength={50} />
    <div className="master-data-checks">
      <label className="master-data-check"><input type="checkbox" name="billingContact" defaultChecked={contact?.billingContact ?? false} /> Billing contact</label>
      <label className="master-data-check"><input type="checkbox" name="primaryContact" defaultChecked={contact?.primaryContact ?? false} /> Primary contact</label>
      {contact && <label className="master-data-check"><input type="checkbox" name="active" defaultChecked={contact.active} /> Active</label>}
    </div>
    <FormMessage state={state} />
    <button className="entry-button entry-button-light" disabled={pending}>{pending ? "Saving…" : contact ? "Save contact" : "Add contact"}</button>
  </form>;
}

export function ServiceForm({ organizationSlug, service }: { organizationSlug: string; service?: { id: string; name: string; description: string | null; defaultUnitPrice: string | null; currencyCode: string; active: boolean } }) {
  const router = useRouter();
  const action = service ? updateServiceAction.bind(null, organizationSlug, service.id) : createServiceAction.bind(null, organizationSlug);
  const [state, formAction, pending] = useActionState(action, initialState);
  useEffect(() => {
    if (state.entityId) router.replace(`/app/${encodeURIComponent(organizationSlug)}/services/${encodeURIComponent(state.entityId)}`);
    else if (state.success) router.refresh();
  }, [organizationSlug, router, state.entityId, state.success]);
  return <form action={formAction} className="entry-card master-data-form">
    <div className="entry-section-heading"><div><h2>Service details</h2><p>The default price is a convenience for future invoice drafts.</p></div></div>
    <div className="master-data-fields">
      <Field label="Service name" name="name" required defaultValue={service?.name ?? ""} maxLength={200} />
      <Field label="Description" name="description" multiline defaultValue={service?.description ?? ""} maxLength={2000} />
      <Field label="Default price" name="defaultUnitPrice" inputMode="decimal" defaultValue={service?.defaultUnitPrice ?? ""} maxLength={20} />
      <Field label="Default price currency" name="currencyCode" required defaultValue={service?.currencyCode ?? "LKR"} maxLength={3} />
      <label className="master-data-check"><input type="checkbox" name="active" defaultChecked={service?.active ?? true} /> Active service</label>
    </div>
    <p className="master-data-note">A default price is used only when explicitly selected and when its currency matches the invoice. Explicit invoice prices take precedence.</p>
    <FormMessage state={state} />
    <div className="master-data-form-actions"><button className="entry-button entry-button-primary" disabled={pending}>{pending ? "Saving…" : service ? "Save Service" : "Create Service"}</button></div>
  </form>;
}

function Field({ label, name, defaultValue, required = false, maxLength, type = "text", inputMode, multiline = false }: { label: string; name: string; defaultValue: string; required?: boolean; maxLength: number; type?: string; inputMode?: "decimal"; multiline?: boolean }) {
  const id = `master-${name}-${useId()}`;
  return <label className="entry-field" htmlFor={id}>{label}{multiline
    ? <textarea id={id} name={name} defaultValue={defaultValue} required={required} maxLength={maxLength} />
    : <input id={id} name={name} type={type} inputMode={inputMode} defaultValue={defaultValue} required={required} maxLength={maxLength} />}</label>;
}

function FormMessage({ state }: { state: MasterDataActionState }) {
  return state.error ? <p className="entry-error" role="alert">{state.error}</p> : state.success ? <p className="entry-success" role="status">{state.success}</p> : null;
}
