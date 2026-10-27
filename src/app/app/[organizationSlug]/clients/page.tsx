import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireOrganizationBySlug, AuthorizationError, OrganizationContextNotFoundError, ProvisioningError } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { loadClientWorkspace } from "@/lib/master-data/workspaces";
import { MasterDataAccessMessage, MasterDataShell } from "@/components/master-data/workspace-shell";

export const dynamic = "force-dynamic";
type Params = Readonly<Record<string, string | string[] | undefined>>;

export default async function ClientsPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<Params> }) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "CLIENT_READ"); }
  catch (error) { if (error instanceof OrganizationContextNotFoundError) notFound(); return <MasterDataAccessMessage message={accessMessage(error)} />; }
  const result = await loadClientWorkspace(workspace.organizationId, query);
  const canCreate = hasPermission(workspace.role, "CLIENT_CREATE");
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/clients`;
  const queryPart = result.query ? `&q=${encodeURIComponent(result.query)}` : "";
  const hrefFor = (page: number) => `${base}?page=${page}${queryPart}`;
  return <MasterDataShell workspace={workspace} section="clients">
    <header className="entry-header"><div><div className="entry-eyebrow">MASTER DATA</div><div className="entry-title-row"><h1>Clients</h1></div></div>{canCreate && <Link className="entry-button entry-button-primary" href={`${base}/new`}>+ New Client</Link>}</header>
    <section className="entry-card master-data-list" aria-labelledby="clients-heading">
      <div className="invoice-workspace-list-heading"><div><h2 id="clients-heading">Clients</h2><p>{result.totalRows} {result.totalRows === 1 ? "client" : "clients"} match this search.</p></div></div>
      <form className="master-data-search" method="get" action={base}><label className="entry-field" htmlFor="client-search">Search clients<input id="client-search" type="search" name="q" maxLength={100} defaultValue={result.query} placeholder="Name, email, phone, or registration ID" /></label><button className="entry-button entry-button-primary">Search</button>{result.query && <Link className="entry-button entry-button-light" href={base}>Clear search</Link>}</form>
      {!result.rows.length ? <div className="invoice-workspace-empty"><strong>{result.organizationClientCount === 0 ? "No clients yet." : "No clients match this search."}</strong>{result.organizationClientCount === 0 && canCreate ? <Link className="entry-button entry-button-primary" href={`${base}/new`}>Create your first client</Link> : result.query ? <Link className="entry-button entry-button-light" href={base}>Clear search</Link> : null}</div> : <>
        <div className="invoice-workspace-table-wrap"><table className="master-data-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>{result.rows.map((client) => <tr key={client.id}><td><strong>{client.name}</strong></td><td>{client.email ?? "—"}</td><td>{client.phone ?? "—"}</td><td>{client.billingAddress ?? "—"}</td><td><Status active={client.active} /></td><td>{date(client.updatedAt)}</td><td><Link href={`${base}/${encodeURIComponent(client.id)}`}>{hasPermission(workspace.role, "CLIENT_EDIT") ? "View / Edit" : "View"}</Link></td></tr>)}</tbody></table></div>
        <div className="master-data-cards">{result.rows.map((client) => <article className="master-data-card" key={client.id}><header><strong>{client.name}</strong><Status active={client.active} /></header><dl><div><dt>Email</dt><dd>{client.email ?? "—"}</dd></div><div><dt>Phone</dt><dd>{client.phone ?? "—"}</dd></div><div><dt>Address</dt><dd>{client.billingAddress ?? "—"}</dd></div><div><dt>Updated</dt><dd>{date(client.updatedAt)}</dd></div></dl><Link className="entry-button entry-button-light" href={`${base}/${encodeURIComponent(client.id)}`}>{hasPermission(workspace.role, "CLIENT_EDIT") ? "View / Edit" : "View"}</Link></article>)}</div>
        <Pagination page={result.page} totalPages={result.totalPages} previous={result.page > 1 ? hrefFor(result.page - 1) : undefined} next={result.page < result.totalPages ? hrefFor(result.page + 1) : undefined} />
      </>}
    </section>
  </MasterDataShell>;
}

function Status({ active }: { active: boolean }) { return <span className={`master-data-status ${active ? "is-active" : "is-inactive"}`}>{active ? "Active" : "Inactive"}</span>; }
function date(value: Date) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Colombo" }).format(value); }
function Pagination({ page, totalPages, previous, next }: { page: number; totalPages: number; previous?: string; next?: string }) { return <nav className="invoice-workspace-pagination" aria-label="Client pages">{previous ? <Link className="entry-button entry-button-light" href={previous}>Previous</Link> : <span className="entry-button entry-button-light is-disabled">Previous</span>}<span>Page {page} of {totalPages}</span>{next ? <Link className="entry-button entry-button-light" href={next}>Next</Link> : <span className="entry-button entry-button-light is-disabled">Next</span>}</nav>; }
function accessMessage(error: unknown) { return process.env.NODE_ENV !== "production" && (error instanceof AuthenticationError || error instanceof ProvisioningError) ? error.message : error instanceof AuthorizationError ? "You do not have permission to view clients in this organization." : "We couldn't verify access to this workspace."; }
