import { readFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import type { InvoiceView } from "./config";
import { renderInvoiceHtml } from "./registry";
import { resolveBrowserExecutable } from "./browser-executable";

export type GenerateInvoicePdfInput = Readonly<{
  rendererKey: string;
  config: unknown;
  invoice: InvoiceView;
}>;

export function invoicePdfFilename(invoiceNumber: string): string {
  if (!/^I\d{8}\d+$/.test(invoiceNumber)) throw new TypeError("Invoice number is invalid.");
  return `Invoice-${invoiceNumber}.pdf`;
}

const dmSansFontFiles = [
  [400, "dm-sans-latin-400-normal.woff2"],
  [500, "dm-sans-latin-500-normal.woff2"],
  [600, "dm-sans-latin-600-normal.woff2"],
  [700, "dm-sans-latin-700-normal.woff2"],
] as const;

export async function buildInvoicePdfHtml({ rendererKey, config, invoice }: GenerateInvoicePdfInput): Promise<string> {
  const rendererProps = { config, invoice };
  const [invoiceCss, letterhead, ...dmSansFonts] = await Promise.all([
    readFile(path.join(process.cwd(), "src/app/invoice-print.css"), "utf8"),
    readFile(path.join(process.cwd(), "public/branding/hiiiive-invoice-letterhead.png")),
    ...dmSansFontFiles.map(([, filename]) => readFile(path.join(
      process.cwd(), "node_modules/@fontsource/dm-sans/files", filename,
    ))),
  ]);
  const letterheadDataUrl = `data:image/png;base64,${letterhead.toString("base64")}`;
  const fontFaceCss = dmSansFontFiles.map(([weight], index) =>
    `@font-face{font-family:"DM Sans";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${dmSansFonts[index]!.toString("base64")}) format("woff2");}`,
  ).join("");
  const css = `${fontFaceCss}\n${invoiceCss.replaceAll("/branding/hiiiive-invoice-letterhead.png", letterheadDataUrl)}`;
  const invoiceMarkup = renderInvoiceHtml(rendererKey, rendererProps);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main class="preview-shell"><div class="invoice-preview-frame"><div class="invoice-preview-scale">${invoiceMarkup}</div></div></main></body></html>`;
}

export async function generateInvoicePdf(input: GenerateInvoicePdfInput): Promise<Uint8Array> {
  const html = await buildInvoicePdfHtml(input);
  const browser = await puppeteer.launch({
    executablePath: resolveBrowserExecutable(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().startsWith("data:")) void request.continue();
      else void request.abort();
    });
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const pdfBytes = Buffer.from(pdf);
    if (pdfBytes.byteLength === 0 || pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Chromium returned invalid PDF data.");
    }
    if ((pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length !== 1) {
      throw new Error("The Hiiiive MVP invoice must fit on one A4 page.");
    }
    return pdfBytes;
  } finally {
    await browser.close();
  }
}
