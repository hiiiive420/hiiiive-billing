import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { devSampleInvoice, devSampleTemplateConfig } from "./dev-sample";
import { buildInvoicePdfHtml, generateInvoicePdf, invoicePdfFilename } from "./generate-pdf-core";
import { renderInvoiceHtml, UnknownInvoiceRendererError } from "./registry";
import { BrowserExecutableError, resolveBrowserExecutable } from "./browser-executable";

describe("server invoice PDF generation", () => {
  it("requires trusted absolute executable configuration in production", () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const previousNodeEnv = mutableEnv.NODE_ENV;
    const previousBrowserPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    mutableEnv.NODE_ENV = "production";
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    try {
      assert.throws(resolveBrowserExecutable, BrowserExecutableError);
      process.env.PUPPETEER_EXECUTABLE_PATH = "relative/chromium";
      assert.throws(resolveBrowserExecutable, BrowserExecutableError);
    } finally {
      if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = previousNodeEnv;
      if (previousBrowserPath === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
      else process.env.PUPPETEER_EXECUTABLE_PATH = previousBrowserPath;
    }
  });

  it("resolves an absolute trusted browser executable for local generation", () => {
    const executablePath = resolveBrowserExecutable();
    assert.ok(existsSync(executablePath));
  });

  it("resolves the trusted renderer and rejects unknown renderers", async () => {
    await assert.rejects(generateInvoicePdf({
      rendererKey: "untrusted-renderer",
      config: devSampleTemplateConfig,
      invoice: devSampleInvoice,
    }), UnknownInvoiceRendererError);
  });

  it("creates a safe deterministic filename", () => {
    assert.equal(invoicePdfFilename("I2026101923"), "Invoice-I2026101923.pdf");
    assert.throws(() => invoicePdfFilename("../../invoice"), TypeError);
    assert.throws(() => invoicePdfFilename("invoice.pdf"), TypeError);
  });

  it("rejects malformed config before starting a browser", async () => {
    await assert.rejects(generateInvoicePdf({
      rendererKey: "hiiiive-default",
      config: { ...devSampleTemplateConfig, primaryColor: "red; background:url(https://bad.test)" },
      invoice: devSampleInvoice,
    }));
  });

  it("escapes invoice text in the trusted renderer HTML", () => {
    const html = renderInvoiceHtml("hiiiive-default", {
      config: devSampleTemplateConfig,
      invoice: { ...devSampleInvoice, clientName: "<img src=x onerror=alert(1)>" },
    });
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img src=/);
  });

  it("embeds the four trusted DM Sans weights without external font URLs", async () => {
    const html = await buildInvoicePdfHtml({
      rendererKey: "hiiiive-default",
      config: devSampleTemplateConfig,
      invoice: devSampleInvoice,
    });
    for (const weight of [400, 500, 600, 700]) {
      assert.match(html, new RegExp(`@font-face\\{font-family:\\"DM Sans\\";font-style:normal;font-weight:${weight};`));
    }
    assert.equal((html.match(/data:font\/woff2;base64,/g) ?? []).length, 4);
    assert.doesNotMatch(html, /https?:\/\/[^\s"')]+\.(?:woff2?|ttf|otf)(?:\?[^\s"')]*)?/i);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/i);
  });

  it("returns one-page A4 PDF bytes without mutating invoice data", async () => {
    const invoice = Object.freeze({
      ...devSampleInvoice,
      items: Object.freeze(devSampleInvoice.items.map((item) => Object.freeze({ ...item }))),
    });
    const before = JSON.stringify(invoice);
    const pdf = await generateInvoicePdf({
      rendererKey: "hiiiive-default",
      config: devSampleTemplateConfig,
      invoice,
    });
    const pdfText = Buffer.from(pdf).toString("latin1");

    assert.ok(pdf.byteLength > 0);
    assert.equal(Buffer.from(pdf.subarray(0, 5)).toString("ascii"), "%PDF-");
    assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
    const mediaBox = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdfText);
    assert.ok(mediaBox);
    assert.ok(Math.abs(Number(mediaBox[1]) - 595.28) < 0.5);
    assert.ok(Math.abs(Number(mediaBox[2]) - 841.89) < 0.1);
    assert.equal(JSON.stringify(invoice), before);
  });
});
