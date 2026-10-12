import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// Loaded through next/font so the file is served from our own domain and
// the text does not flicker while a web font downloads.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Meet Translate (OpenAI)',
  description: 'Video calls where Hindi and Telugu speakers are heard in English, live.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
