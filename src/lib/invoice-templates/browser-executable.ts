import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";

const localBrowserCandidates: Readonly<Record<string, readonly string[]>> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  linux: ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge"],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
};

export class BrowserExecutableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserExecutableError";
  }
}

export function resolveBrowserExecutable(): string {
  const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configuredPath) {
    if (!path.isAbsolute(configuredPath)) {
      throw new BrowserExecutableError("PUPPETEER_EXECUTABLE_PATH must be an absolute server-configured path.");
    }
    try {
      if (!statSync(configuredPath).isFile()) throw new Error("not a file");
      accessSync(configuredPath, process.platform === "win32" ? constants.R_OK : constants.X_OK);
    } catch {
      throw new BrowserExecutableError(`Configured Chromium executable is unavailable at ${configuredPath}.`);
    }
    return configuredPath;
  }

  if (process.env.NODE_ENV === "production") {
    throw new BrowserExecutableError("Set PUPPETEER_EXECUTABLE_PATH to an installed Chromium executable before generating PDFs.");
  }

  const localPath = (localBrowserCandidates[process.platform] ?? []).find(existsSync);
  if (!localPath) {
    throw new BrowserExecutableError("No local Chromium or Chrome executable was found; set PUPPETEER_EXECUTABLE_PATH for development/tests.");
  }
  return localPath;
}
