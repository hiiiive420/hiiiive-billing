import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { ServiceForm } from "@/components/master-data/forms";
import { MasterDataAccessMessage, MasterDataShell } from "@/components/master-data/workspace-shell";

export const dynamic = "force-dynamic";
export default async function NewServicePage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "SERVICE_CREATE"); }
  catch (error) { if (error instanceof OrganizationContextNotFoundError) notFound(); return <MasterDataAccessMessage message={error instanceof AuthorizationError ? "You do not have permission to create services in this organization." : "We couldn't verify access to this workspace."} />; }
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/services`;
  return <MasterDataShell workspace={workspace} section="services"><header className="entry-header"><div><div className="entry-eyebrow"><Link href={base}>Services</Link> <span>›</span> NEW</div><div className="entry-title-row"><h1>New Service</h1></div></div></header><ServiceForm organizationSlug={workspace.organizationSlug} /></MasterDataShell>;
}
