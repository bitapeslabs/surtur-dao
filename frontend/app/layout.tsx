import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import NextTopLoader from 'nextjs-toploader';
import { VendorWalletProvider } from '@/context/VendorWalletContext';
import QueryProvider from '@/components/QueryProvider';
import Header from '@/components/Header';
import MobileBottomNav from '@/components/MobileBottomNav';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Surtur',
  description:
    'Surtur — DAO governance over alkane treasuries. Connect a SUBFROST wallet via the subfrost-connect SDK, view your portfolio, and browse or create proposals.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        {/* White navigation progress bar along the top edge. */}
        <NextTopLoader color="#ececf1" height={2} showSpinner={false} shadow={false} />
        <QueryProvider>
        <VendorWalletProvider>
          <Header />
          {children}
          {/* Spacer so fixed bottom nav doesn't cover content on mobile. */}
          <div className="h-16 md:hidden" />
          <MobileBottomNav />
        </VendorWalletProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
