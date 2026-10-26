import { redirect } from "next/navigation";
import { AuthenticationError } from "@/lib/auth/identity";
import { AuthorizationError, getCurrentUserMemberships, ProvisioningError } from "@/lib/auth/authorization";

export default async function ApplicationHomePage() {
  let memberships: Awaited<ReturnType<typeof getCurrentUserMemberships>> = [];
  let accessMessage: string | null = null;
  try {
    memberships = await getCurrentUserMemberships();
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && (error instanceof AuthenticationError || error instanceof ProvisioningError)) {
      accessMessage = error.message;
    } else {
      accessMessage = error instanceof AuthorizationError
        ? "You do not have permission to access this workspace."
        : "We couldn't verify access to your workspace.";
    }
  }

  if (accessMessage) return <WorkspaceMessage message={accessMessage} />;
  if (!memberships?.length) return <WorkspaceMessage message="Your account is not provisioned for an organization yet. Contact an administrator." />;
  if (memberships.length === 1) {
    redirect(`/app/${encodeURIComponent(memberships[0]!.organization.slug)}/invoices`);
  }

  return <main className="app-workspace-gate">
    <section className="app-workspace-card" aria-labelledby="workspace-heading">
      <p className="app-workspace-brand">Hiiiive Billing</p>
      <h1 id="workspace-heading">Choose an organization</h1>
      <p>Select an organization where you have active access.</p>
      <ul>{memberships.map(({ id, organization }) => <li key={id}>
        <a href={`/app/${encodeURIComponent(organization.slug)}/invoices`}>
          <strong>{organization.name}</strong><span>Open invoice workspace</span>
        </a>
      </li>)}</ul>
    </section>
  </main>;
}

function WorkspaceMessage({ message }: { message: string }) {
  return <main className="app-workspace-gate">
    <section className="app-workspace-card" role="status">
      <p className="app-workspace-brand">Hiiiive Billing</p>
      <h1>Workspace access</h1>
      <p>{message}</p>
    </section>
  </main>;
}
