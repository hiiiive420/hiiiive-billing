const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft", ISSUED: "Issued", SUPERSEDED: "Superseded", VOID: "Void", WRITTEN_OFF: "Written off",
  UNPAID: "Unpaid", PARTIALLY_PAID: "Partially paid", PAID: "Paid",
  ACTIVE: "Active", INACTIVE: "Inactive",
  PAUSED: "Paused", GENERATED: "Generated",
  PENDING: "Sending", SENDING: "Sending", SENT: "Sent", PARTIALLY_SENT: "Partially sent", FAILED: "Failed", NEVER_SENT: "Never sent",
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const normalized = status.toLowerCase().replaceAll("_", "-");
  return <span className={`invoice-status-chip status-chip status-chip-${normalized}`}>
    {label ?? STATUS_LABELS[status] ?? status.replaceAll("_", " ")}
  </span>;
}
