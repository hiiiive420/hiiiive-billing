import Link from "next/link";
import type { ReactNode } from "react";
import { hasPermission } from "@/lib/auth/authorization";
import { ThemeToggle } from "@/components/theme-toggle";

type Workspace = { organizationSlug: string; organizationName: string; userLabel: string; role: string };
type WorkspaceArea = "invoices" | "clients" | "services" | "recurring" | "settings";

export function WorkspaceHeader({ workspace, current }: { workspace: Workspace; current: WorkspaceArea }) {
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}`;
  return <div className="app-workspace-chrome">
    <div className="entry-workspace-bar">
      <Link className="app-workspace-brand" href="/app">Hiiiive Billing</Link>
      <span className="workspace-brand-separator" aria-hidden="true" />
      <span className="app-workspace-organization">{workspace.organizationName}</span>
      <span className="entry-workspace-user">{workspace.userLabel} · {workspace.role}</span>
      <ThemeToggle />
    </div>
    <nav className="master-data-nav" aria-label="Workspace navigation">
      {hasPermission(workspace.role, "INVOICE_READ") && <Link aria-current={current === "invoices" ? "page" : undefined} href={`${base}/invoices`}>Invoices</Link>}
      {hasPermission(workspace.role, "CLIENT_READ") && <Link aria-current={current === "clients" ? "page" : undefined} href={`${base}/clients`}>Clients</Link>}
      {hasPermission(workspace.role, "SERVICE_READ") && <Link aria-current={current === "services" ? "page" : undefined} href={`${base}/services`}>Services</Link>}
      {hasPermission(workspace.role, "RECURRING_INVOICE_READ") && <Link aria-current={current === "recurring" ? "page" : undefined} href={`${base}/recurring`}>Recurring</Link>}
      {hasPermission(workspace.role, "ORGANIZATION_SETTINGS") && <Link aria-current={current === "settings" ? "page" : undefined} href={`${base}/settings`}>Settings</Link>}
    </nav>
  </div>;
}

export function MasterDataShell({ workspace, children, section }: { workspace: Workspace; children: ReactNode; section: "clients" | "services" }) {
  return <main className="entry-page entry-page-production master-data-page">
    <WorkspaceHeader workspace={workspace} current={section} />
    {children}
  </main>;
}

export function MasterDataAccessMessage({ message = "We couldn't verify access to this workspace." }: { message?: string }) {
  return <main className="app-workspace-gate"><section className="app-workspace-card" role="status"><p className="app-workspace-brand">Hiiiive Billing</p><h1>Workspace access</h1><p>{message}</p></section></main>;
}
