import type { InvoMessage, InvoTarget } from "@/lib/ai/invo-contract";

export type InvoAssistantViewState = Readonly<{
  open: boolean;
  greetingVisible: boolean;
  appliedMessage: string | null;
}>;
export type InvoAssistantViewAction =
  | Readonly<{ type: "OPEN" }>
  | Readonly<{ type: "MINIMIZE" }>
  | Readonly<{ type: "DISMISS_GREETING" }>
  | Readonly<{ type: "APPLIED"; target: InvoTarget }>
  | Readonly<{ type: "CHANGE_DETAILS" }>
  | Readonly<{ type: "START_OVER" }>;

export const INITIAL_INVO_ASSISTANT_VIEW_STATE: InvoAssistantViewState = {
  open: false, greetingVisible: true, appliedMessage: null,
};

export function detectInvoWrongMode(target: InvoTarget, content: string): InvoTarget | null {
  if (target === "RECURRING" && /^\s*(?:please\s+)?(?:invoice|bill)\b/i.test(content)) return "INVOICE";
  if (target === "INVOICE" && /^\s*(?:please\s+)?(?:create|set\s+up|setup|start)\s+(?:an?\s+)?(?:(?:annual|yearly|monthly|recurring)\s+)?(?:billing|plan|subscription)\b/i.test(content)) return "RECURRING";
  return null;
}

export function acquireInvoRequest(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function appendInvoUserMessage(messages: InvoMessage[], content: string, retryContent: string | null): InvoMessage[] {
  const last = messages.at(-1);
  if (retryContent === content && last?.role === "user" && last.content === content) return messages;
  return [...messages, { role: "user" as const, content }].slice(-14);
}

export function getInvoRetryDraft(messages: InvoMessage[]): string | null {
  return messages.at(-1)?.role === "user" ? messages.at(-1)!.content : null;
}

export function invoAssistantViewReducer(state: InvoAssistantViewState, action: InvoAssistantViewAction): InvoAssistantViewState {
  switch (action.type) {
    case "OPEN": return { ...state, open: true, greetingVisible: false };
    case "MINIMIZE": return { ...state, open: false };
    case "DISMISS_GREETING": return { ...state, greetingVisible: false };
    case "APPLIED": return {
      ...state, open: true, greetingVisible: false,
      appliedMessage: action.target === "INVOICE"
        ? "Applied to the invoice form. You can review or edit anything before issuing."
        : "Applied to the recurring plan form. Review it, then create the plan when you're ready.",
    };
    case "CHANGE_DETAILS": return { ...state, appliedMessage: null };
    case "START_OVER": return { ...state, appliedMessage: null };
  }
}
