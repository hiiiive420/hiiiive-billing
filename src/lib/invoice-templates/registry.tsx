import type { ReactNode } from "react";
import { HiiiiveInvoice, type HiiiiveInvoiceProps } from "./hiiiive-default";

export type InvoiceRendererKey = "hiiiive-default";
type InvoiceRenderer = (props: HiiiiveInvoiceProps) => ReactNode;

const renderers: Readonly<Record<InvoiceRendererKey, InvoiceRenderer>> = {
  "hiiiive-default": HiiiiveInvoice,
};

export class UnknownInvoiceRendererError extends Error {
  constructor(rendererKey: string) {
    super(`Unknown invoice renderer: ${rendererKey}`);
    this.name = "UnknownInvoiceRendererError";
  }
}

export function resolveInvoiceRenderer(rendererKey: string): InvoiceRenderer {
  if (!Object.hasOwn(renderers, rendererKey)) throw new UnknownInvoiceRendererError(rendererKey);
  return renderers[rendererKey as InvoiceRendererKey];
}
