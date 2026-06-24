import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grounded — retrieval Q&A that cites its sources or refuses",
  description:
    "A retrieval Q&A agent that answers from a corpus with citations and refuses when the answer is not grounded.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
