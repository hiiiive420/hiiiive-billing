import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { ClientForm } from "@/components/master-data/forms";
import { MasterDataAccessMessage, MasterDataShell } from "@/components/master-data/workspace-shell";

export const dynamic = "force-dynamic";

export default async function NewClientPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "CLIENT_CREATE"); }
  catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <MasterDataAccessMessage message={error instanceof AuthorizationError ? "You do not have permission to create clients in this organization." : "We couldn't verify access to this workspace."} />;
  }
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/clients`;
  return <MasterDataShell workspace={workspace} section="clients"><header className="entry-header"><div><div className="entry-eyebrow"><Link href={base}>Clients</Link> <span>›</span> NEW</div><div className="entry-title-row"><h1>New Client</h1></div></div></header><ClientForm organizationSlug={workspace.organizationSlug} /></MasterDataShell>;
}
