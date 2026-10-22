import type { ReactNode } from "react";
import { HiiiiveInvoice, renderHiiiiveInvoiceHtml, type HiiiiveInvoiceProps } from "./hiiiive-default";

export type InvoiceRendererKey = "hiiiive-default";
type InvoiceRenderer = Readonly<{
  component: (props: HiiiiveInvoiceProps) => ReactNode;
  renderHtml: (props: HiiiiveInvoiceProps) => string;
}>;

const renderers: Readonly<Record<InvoiceRendererKey, InvoiceRenderer>> = {
  "hiiiive-default": { component: HiiiiveInvoice, renderHtml: renderHiiiiveInvoiceHtml },
};

export class UnknownInvoiceRendererError extends Error {
  constructor(rendererKey: string) {
    super(`Unknown invoice renderer: ${rendererKey}`);
    this.name = "UnknownInvoiceRendererError";
  }
}

function resolveInvoiceRendererEntry(rendererKey: string): InvoiceRenderer {
  if (!Object.hasOwn(renderers, rendererKey)) throw new UnknownInvoiceRendererError(rendererKey);
  return renderers[rendererKey as InvoiceRendererKey];
}

export function resolveInvoiceRenderer(rendererKey: string) {
  return resolveInvoiceRendererEntry(rendererKey).component;
}

export function renderInvoiceHtml(rendererKey: string, props: HiiiiveInvoiceProps): string {
  return resolveInvoiceRendererEntry(rendererKey).renderHtml(props);
}
