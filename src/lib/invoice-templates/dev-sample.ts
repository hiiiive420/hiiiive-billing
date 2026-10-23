import type { InvoiceView } from "./config";

export const devSampleInvoice: InvoiceView = {
  invoiceNumber: "I2026101923",
  projectTitle: "Price Pointer Artwork",
  invoiceDate: "2026-10-19",
  clientName: "Visaga Clothing Hub",
  clientBillingAddress: null,
  currencyCode: "LKR",
  items: [{
    billingMode: "QUANTITY",
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
};

export const devSampleTemplateConfig = {
  companyName: "Hiiiive",
  bankName: "",
  accountName: "",
  accountNumber: "",
  headingFontName: "DejaVu Serif",
  bodyFontName: "DM Sans",
  primaryColor: "#255B83",
} as const;
