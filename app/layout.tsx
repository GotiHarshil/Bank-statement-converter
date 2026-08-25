import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bank Statement Converter',
  description:
    'Convert Indian bank statement PDFs into arithmetically verified Excel and CSV files. Every row is reconciled against the running balance before you export.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
