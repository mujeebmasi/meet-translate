import type { Metadata } from 'next';
import { Bricolage_Grotesque, Inter, Noto_Sans_Devanagari, Noto_Sans_Telugu } from 'next/font/google';
import './globals.css';

// Loaded through next/font so the files are served from our own domain and
// the text does not flicker while a web font downloads.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
// Headlines on the home page.
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage' });
// The speaker's own words in the home page's example call.
const devanagari = Noto_Sans_Devanagari({ subsets: ['devanagari'], variable: '--font-devanagari' });
const telugu = Noto_Sans_Telugu({ subsets: ['telugu'], variable: '--font-telugu' });

export const metadata: Metadata = {
  title: 'Meet Translate',
  description: 'Video calls in Hindi, Telugu and English where everyone hears the others in their own language, live.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${devanagari.variable} ${telugu.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
