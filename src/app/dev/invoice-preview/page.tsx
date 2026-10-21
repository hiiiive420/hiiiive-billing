import { notFound } from "next/navigation";
import { resolveInvoiceRenderer } from "@/lib/invoice-templates/registry";
import { InvoicePreviewScale } from "./invoice-preview-scale";

const InvoiceRenderer = resolveInvoiceRenderer("hiiiive-default");

const sampleInvoice = {
  invoiceNumber: "I2026101923",
  projectTitle: "Price Pointer Artwork",
  invoiceDate: "2026-10-19",
  clientName: "Visaga Clothing Hub",
  clientBillingAddress: null,
  currencyCode: "LKR",
  items: [{
    description: "Price Pointer Artwork",
    quantity: "185",
    unitPrice: "100.00",
    lineTotal: "18500.00",
  }],
  subtotal: "18500.00",
  discountLabel: "PREFERRED CLIENT DISCOUNT",
  discountAmount: "4625.00",
  grandTotal: "13875.00",
  notes: "Preferred Client Discount applied. 185 price pointer artworks supplied as 370 sides for double-sided printing.",
} as const;

const sampleConfig = {
  companyName: "Hiiiive",
  bankName: "",
  accountName: "",
  accountNumber: "",
  headingFontName: "DejaVu Serif",
  bodyFontName: "DM Sans",
  primaryColor: "#255B83",
  currencyDisplayLabel: "LKR",
} as const;

export default function InvoicePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="preview-shell">
      <div className="preview-banner">
        <strong>Development preview</strong> | Static sample invoice | Not connected to invoice data
      </div>
      <InvoicePreviewScale><InvoiceRenderer config={sampleConfig} invoice={sampleInvoice} /></InvoicePreviewScale>
    </main>
  );
}
