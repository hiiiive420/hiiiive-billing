import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireOrganizationBySlug, AuthorizationError, OrganizationContextNotFoundError } from "@/lib/auth/authorization";
import { loadServiceDetail, MasterDataNotFoundError } from "@/lib/master-data/workspaces";
import { ServiceForm } from "@/components/master-data/forms";
import { MasterDataAccessMessage, MasterDataShell } from "@/components/master-data/workspace-shell";

export const dynamic = "force-dynamic";
export default async function ServiceDetailPage({ params }: { params: Promise<{ organizationSlug: string; serviceId: string }> }) {
  const { organizationSlug, serviceId } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "SERVICE_READ"); }
  catch (error) { if (error instanceof OrganizationContextNotFoundError) notFound(); return <MasterDataAccessMessage message={error instanceof AuthorizationError ? "You do not have permission to view services in this organization." : "We couldn't verify access to this workspace."} />; }
  let service;
  try { service = await loadServiceDetail(workspace.organizationId, serviceId); }
  catch (error) { if (error instanceof MasterDataNotFoundError) notFound(); throw error; }
  const canEdit = hasPermission(workspace.role, "SERVICE_EDIT");
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/services`;
  return <MasterDataShell workspace={workspace} section="services"><header className="entry-header"><div><div className="entry-eyebrow"><Link href={base}>Services</Link> <span>›</span> SERVICE</div><div className="entry-title-row"><h1>{service.name}</h1><span className={`master-data-status ${service.active ? "is-active" : "is-inactive"}`}>{service.active ? "Active" : "Inactive"}</span></div></div></header>{canEdit ? <ServiceForm organizationSlug={workspace.organizationSlug} service={service} /> : <section className="entry-card master-data-readonly"><h2>Service details</h2><p>{service.description ?? "No description"}</p><p>{service.defaultUnitPrice === null ? "No default price" : `${service.currencyCode} ${service.defaultUnitPrice}`}</p></section>}</MasterDataShell>;
}
