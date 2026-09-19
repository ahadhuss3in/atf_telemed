import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "atf telehealth",
  description: "Peer-to-peer video consultations between patients and doctors.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}