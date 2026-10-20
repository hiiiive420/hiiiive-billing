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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
