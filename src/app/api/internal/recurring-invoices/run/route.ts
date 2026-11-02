import { runDueRecurringInvoices } from "@/lib/recurring/recurring-invoices";
import { handleRecurringInvoiceCron } from "./cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRecurringInvoiceCron(request, runDueRecurringInvoices);
}
