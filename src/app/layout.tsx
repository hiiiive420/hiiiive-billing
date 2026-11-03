import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hiiiive Billing",
  description: "Hiiiive Billing application foundation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{const saved=localStorage.getItem("hiiiive-billing-theme");document.documentElement.dataset.theme=saved==="light"||saved==="dark"?saved:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch{document.documentElement.dataset.theme="light"}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
