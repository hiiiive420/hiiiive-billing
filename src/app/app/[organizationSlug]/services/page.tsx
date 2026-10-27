import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireOrganizationBySlug, AuthorizationError, OrganizationContextNotFoundError } from "@/lib/auth/authorization";
import { loadServiceWorkspace } from "@/lib/master-data/workspaces";
import { MasterDataAccessMessage, MasterDataShell } from "@/components/master-data/workspace-shell";
import { formatMoneyDisplay } from "@/lib/invoices/invoice-entry-ui";
export const dynamic = "force-dynamic";
type Params = Readonly<Record<string, string | string[] | undefined>>;

export default async function ServicesPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<Params> }) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "SERVICE_READ"); }
  catch (error) { if (error instanceof OrganizationContextNotFoundError) notFound(); return <MasterDataAccessMessage message={error instanceof AuthorizationError ? "You do not have permission to view services in this organization." : "We couldn't verify access to this workspace."} />; }
  const result = await loadServiceWorkspace(workspace.organizationId, query);
  const canCreate = hasPermission(workspace.role, "SERVICE_CREATE");
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/services`;
  const queryPart = result.query ? `&q=${encodeURIComponent(result.query)}` : "";
  const pageHref = (page: number) => `${base}?page=${page}${queryPart}`;
  return <MasterDataShell workspace={workspace} section="services">
    <header className="entry-header"><div><div className="entry-eyebrow">MASTER DATA</div><div className="entry-title-row"><h1>Services</h1></div></div>{canCreate && <Link className="entry-button entry-button-primary" href={`${base}/new`}>+ New Service</Link>}</header>
    <section className="entry-card master-data-list" aria-labelledby="services-heading">
      <div className="invoice-workspace-list-heading"><div><h2 id="services-heading">Services</h2><p>{result.totalRows} {result.totalRows === 1 ? "service" : "services"} match this search.</p></div></div>
      <form className="master-data-search" method="get" action={base}><label className="entry-field" htmlFor="service-search">Search services<input id="service-search" type="search" name="q" maxLength={100} defaultValue={result.query} placeholder="Name or description" /></label><button className="entry-button entry-button-primary">Search</button>{result.query && <Link className="entry-button entry-button-light" href={base}>Clear search</Link>}</form>
      {!result.rows.length ? <div className="invoice-workspace-empty"><strong>{result.organizationServiceCount === 0 ? "No services yet." : "No services match this search."}</strong>{result.organizationServiceCount === 0 && canCreate ? <Link className="entry-button entry-button-primary" href={`${base}/new`}>Create your first service</Link> : result.query ? <Link className="entry-button entry-button-light" href={base}>Clear search</Link> : null}</div> : <>
        <div className="invoice-workspace-table-wrap"><table className="master-data-table"><thead><tr><th>Name</th><th>Description</th><th>Default price</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>{result.rows.map((service) => <tr key={service.id}><td><strong>{service.name}</strong></td><td>{service.description ?? "—"}</td><td>{service.defaultUnitPrice === null ? "—" : `${service.currencyCode} ${formatMoneyDisplay(service.defaultUnitPrice)}`}</td><td><Status active={service.active} /></td><td>{date(service.updatedAt)}</td><td><Link href={`${base}/${encodeURIComponent(service.id)}`}>{hasPermission(workspace.role, "SERVICE_EDIT") ? "View / Edit" : "View"}</Link></td></tr>)}</tbody></table></div>
        <div className="master-data-cards">{result.rows.map((service) => <article className="master-data-card" key={service.id}><header><strong>{service.name}</strong><Status active={service.active} /></header><dl><div><dt>Description</dt><dd>{service.description ?? "—"}</dd></div><div><dt>Default price</dt><dd>{service.defaultUnitPrice === null ? "—" : `${service.currencyCode} ${formatMoneyDisplay(service.defaultUnitPrice)}`}</dd></div><div><dt>Updated</dt><dd>{date(service.updatedAt)}</dd></div></dl><Link className="entry-button entry-button-light" href={`${base}/${encodeURIComponent(service.id)}`}>{hasPermission(workspace.role, "SERVICE_EDIT") ? "View / Edit" : "View"}</Link></article>)}</div>
        <nav className="invoice-workspace-pagination" aria-label="Service pages">{result.page > 1 ? <Link className="entry-button entry-button-light" href={pageHref(result.page - 1)}>Previous</Link> : <span className="entry-button entry-button-light is-disabled">Previous</span>}<span>Page {result.page} of {result.totalPages}</span>{result.page < result.totalPages ? <Link className="entry-button entry-button-light" href={pageHref(result.page + 1)}>Next</Link> : <span className="entry-button entry-button-light is-disabled">Next</span>}</nav>
      </>}
    </section>
  </MasterDataShell>;
}
function Status({ active }: { active: boolean }) { return <span className={`master-data-status ${active ? "is-active" : "is-inactive"}`}>{active ? "Active" : "Inactive"}</span>; }
function date(value: Date) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Colombo" }).format(value); }
