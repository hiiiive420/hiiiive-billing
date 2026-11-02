import { timingSafeEqual } from "node:crypto";

export async function handleRecurringInvoiceCron(
  request: Request,
  run: () => Promise<unknown>,
) {
  const secret = process.env.RECURRING_INVOICE_CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return Response.json({ error: "Cron endpoint is not configured." }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(\S+)$/i);
  const supplied = token?.[1] ?? "";
  if (!constantTimeSecretEqual(supplied, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const result = await run();
    return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Recurring invoice processing failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

function constantTimeSecretEqual(input: string, expected: string) {
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}
