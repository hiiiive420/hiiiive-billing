"use client";

import { useActionState } from "react";
import { saveInvoiceDisplaySettingsAction, saveOrganizationSettingsAction, type SettingsActionState } from "./actions";

const initial: SettingsActionState = {};

export function OrganizationSettingsForm({ slug, name }: { slug: string; name: string }) {
  const action = saveOrganizationSettingsAction.bind(null, slug);
  const [state, formAction, pending] = useActionState(action, initial);
  return <form action={formAction} className="entry-card settings-form">
    <div className="entry-section-heading"><div><h2>Organization</h2><p>Used inside the billing application.</p></div></div>
    <div className="settings-fields">
      <label className="entry-field">Organization name<input name="name" defaultValue={name} maxLength={200} required /></label>
      <label className="entry-field">Organization slug<input value={slug} readOnly aria-readonly="true" /><span className="settings-help">The organization URL is read-only.</span></label>
    </div>
    <Feedback state={state} /><div className="master-data-form-actions"><button disabled={pending} className="entry-button entry-button-primary">{pending ? "Saving…" : "Save organization"}</button></div>
  </form>;
}

export function InvoiceSettingsForm({ slug, config }: { slug: string; config: { companyName: string; bankName: string; accountName: string; accountNumber: string; primaryColor: string } }) {
  const action = saveInvoiceDisplaySettingsAction.bind(null, slug);
  const [state, formAction, pending] = useActionState(action, initial);
  return <form action={formAction} className="entry-card settings-form">
    <div className="entry-section-heading"><div><h2>Invoice template and payment information</h2><p>These values appear on future invoice documents. Issued documents keep their original version.</p></div></div>
    <div className="settings-fields">
      <label className="entry-field">Invoice display name<input name="companyName" defaultValue={config.companyName} maxLength={200} required /></label>
      <label className="entry-field">Primary invoice color<input type="color" name="primaryColor" defaultValue={config.primaryColor} required /></label>
      <label className="entry-field">Bank name<input name="bankName" defaultValue={config.bankName} maxLength={120} /></label>
      <label className="entry-field">Account name<input name="accountName" defaultValue={config.accountName} maxLength={120} /></label>
      <label className="entry-field">Account number<input name="accountNumber" defaultValue={config.accountNumber} maxLength={80} autoComplete="off" /></label>
      <div className="entry-field"><span className="settings-label">Invoice fonts</span><span className="settings-readonly">DejaVu Serif · DM Sans</span><span className="settings-help">The supported Hiiiive font pairing is fixed.</span></div>
    </div>
    <Feedback state={state} /><div className="master-data-form-actions"><button disabled={pending} className="entry-button entry-button-primary">{pending ? "Saving…" : "Save invoice settings"}</button></div>
  </form>;
}

function Feedback({ state }: { state: SettingsActionState }) {
  return <>{state.error && <p className="entry-error" role="alert">{state.error}</p>}{state.success && <p className="entry-success" role="status">{state.success}</p>}</>;
}
