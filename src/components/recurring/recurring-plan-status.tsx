"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RecurringPlanStatus({ active, planId, setActive }: { active: boolean; planId: string; setActive: (planId: string, active: boolean) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <div><button className="entry-button entry-button-light" type="button" disabled={pending} onClick={() => startTransition(async () => {
    setError(""); const result = await setActive(planId, !active); if (!result.ok) setError(result.error); else router.refresh();
  })}>{pending ? "Saving…" : active ? "Pause recurrence" : "Resume recurrence"}</button>{error && <p className="entry-inline-error" role="alert">{error}</p>}</div>;
}
