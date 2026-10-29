import Link from "next/link";
import type { ReactNode } from "react";
import { hasPermission } from "@/lib/auth/authorization";

type Workspace = { organizationSlug: string; organizationName: string; userLabel: string; role: string };

export function MasterDataShell({ workspace, children, section }: { workspace: Workspace; children: ReactNode; section: "clients" | "services" }) {
  return <main className="entry-page entry-page-production master-data-page">
    <div className="entry-workspace-bar"><strong>Hiiiive Billing</strong><span>{workspace.organizationName}</span><span className="entry-workspace-user">{workspace.userLabel} · {workspace.role}</span></div>
    <MasterDataLinks workspace={workspace} current={section} />
    {children}
  </main>;
}

export function MasterDataLinks({ workspace, current }: { workspace: Workspace; current: "clients" | "services" | "invoices" | "settings" }) {
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}`;
  return <nav className="master-data-nav" aria-label="Workspace navigation">
    <Link aria-current={current === "invoices" ? "page" : undefined} href={`${base}/invoices`}>Invoice Workspace</Link>
    {hasPermission(workspace.role, "CLIENT_READ") && <Link aria-current={current === "clients" ? "page" : undefined} href={`${base}/clients`}>Clients</Link>}
    {hasPermission(workspace.role, "SERVICE_READ") && <Link aria-current={current === "services" ? "page" : undefined} href={`${base}/services`}>Services</Link>}
    {hasPermission(workspace.role, "ORGANIZATION_SETTINGS") && <Link aria-current={current === "settings" ? "page" : undefined} href={`${base}/settings`}>Settings</Link>}
  </nav>;
}

export function MasterDataAccessMessage({ message = "We couldn't verify access to this workspace." }: { message?: string }) {
  return <main className="app-workspace-gate"><section className="app-workspace-card" role="status"><p className="app-workspace-brand">Hiiiive Billing</p><h1>Workspace access</h1><p>{message}</p></section></main>;
}
