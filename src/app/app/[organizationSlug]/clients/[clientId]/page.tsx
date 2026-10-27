import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireOrganizationBySlug, AuthorizationError, OrganizationContextNotFoundError } from "@/lib/auth/authorization";
import { loadClientDetail, MasterDataNotFoundError } from "@/lib/master-data/workspaces";
import { ClientContactForm, ClientForm } from "@/components/master-data/forms";
import { MasterDataAccessMessage, MasterDataShell } from "@/components/master-data/workspace-shell";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: { params: Promise<{ organizationSlug: string; clientId: string }> }) {
  const { organizationSlug, clientId } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "CLIENT_READ"); }
  catch (error) { if (error instanceof OrganizationContextNotFoundError) notFound(); return <MasterDataAccessMessage message={error instanceof AuthorizationError ? "You do not have permission to view clients in this organization." : "We couldn't verify access to this workspace."} />; }
  let client;
  try { client = await loadClientDetail(workspace.organizationId, clientId); }
  catch (error) { if (error instanceof MasterDataNotFoundError) notFound(); throw error; }
  const canEdit = hasPermission(workspace.role, "CLIENT_EDIT");
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/clients`;
  return <MasterDataShell workspace={workspace} section="clients">
    <header className="entry-header"><div><div className="entry-eyebrow"><Link href={base}>Clients</Link> <span>›</span> CLIENT</div><div className="entry-title-row"><h1>{client.name}</h1><span className={`master-data-status ${client.active ? "is-active" : "is-inactive"}`}>{client.active ? "Active" : "Inactive"}</span></div><p className="master-data-updated">Updated {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Colombo" }).format(client.updatedAt)}</p></div></header>
    {canEdit ? <ClientForm organizationSlug={workspace.organizationSlug} client={client} /> : <ClientReadOnly client={client} />}
    <section className="entry-card master-contact-section"><div className="entry-section-heading"><div><h2>Client contacts</h2><p>Contact details are scoped to this client.</p></div></div>
      {client.contacts.length ? <div className="master-contact-list">{client.contacts.map((contact) => <article key={contact.id}><header><strong>{contact.name}</strong><span className={`master-data-status ${contact.active ? "is-active" : "is-inactive"}`}>{contact.active ? "Active" : "Inactive"}</span></header>{canEdit ? <ClientContactForm organizationSlug={workspace.organizationSlug} clientId={client.id} contact={contact} /> : <p>{[contact.email, contact.phone, contact.billingContact ? "Billing contact" : null, contact.primaryContact ? "Primary contact" : null].filter(Boolean).join(" · ") || "No additional details"}</p>}</article>)}</div> : <p className="master-data-note">No contacts have been added.</p>}
      {canEdit && <div className="master-contact-new"><h3>Add contact</h3><ClientContactForm organizationSlug={workspace.organizationSlug} clientId={client.id} /> </div>}
    </section>
  </MasterDataShell>;
}

function ClientReadOnly({ client }: { client: Awaited<ReturnType<typeof loadClientDetail>> }) {
  return <section className="entry-card master-data-readonly"><h2>Client details</h2><dl><div><dt>Email</dt><dd>{client.email ?? "—"}</dd></div><div><dt>Phone</dt><dd>{client.phone ?? "—"}</dd></div><div><dt>Business registration / tax identifier</dt><dd>{client.businessRegistrationOrTaxIdentifier ?? "—"}</dd></div><div><dt>Billing address</dt><dd>{client.billingAddress ?? "—"}</dd></div><div><dt>Notes</dt><dd>{client.notes ?? "—"}</dd></div></dl></section>;
}
