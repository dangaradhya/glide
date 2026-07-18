// app/layout.tsx
import type { Metadata } from "next";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
// Integrated Google OAuth Provider for Authentication
import { GoogleOAuthProvider } from '@react-oauth/google'; 
import "./globals.css";
// Import your theme provider
import { Providers } from './providers';
import AppBanner from '@/components/AppBanner';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face of the design language (see globals.css tokens). The width axis is
// the whole point: one file serves both the expanded-black wordmark/headline voice
// and the condensed-caps label/score voice, selected via font-stretch.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

// Upgraded the metadata for Browser Tabs, SEO, and Social Sharing
// Update for Google Search and Social Media Optimization
export const metadata: Metadata = {
  title: "Glide Sports | AI-Powered Sports Aggregator", 
  description: "Experience clean, AI-curated sports news, immersive vertical highlight reels, and real-time score tracking at the Match Center - built for the modern fan.",
  keywords: ["sports news", "sports aggregator", "highlights", "reels", "match center", "football", "basketball", "mma", "soccer", "tennis", "sports scores", "AI-curated sports"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Glide",
  },
  openGraph: {
    title: "Glide Sports",
    description: "AI-Curated news and highlights built for the modern sports fan.",
    url: "https://glidesports.app",
    siteName: "Glide Sports",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Glide Sports",
    description: "AI-Curated news and highlights built for the modern sports fan.",
  },
};

// Added Viewport configuration for mobile responsiveness and edge-to-edge safe areas
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover", // Essential for safe-area-inset variables to work correctly on iOS/Android
};

// RootLayout now wraps the entire app with GoogleOAuthProvider for seamless authentication across all pages.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Securely load the Google Client ID from environment variables for authentication
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  // The layout includes the GoogleOAuthProvider at the top level, ensuring that all child components can access authentication features without additional setup.
  return (
    // suppressHydrationWarning added to html tag (required by next-themes)
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
    >
      {/* Added light/dark default background and text colors, plus a smooth CSS transition */}
      {/* overscroll-y-contain stops the browser's own native pull-to-refresh/bounce from
          firing at the same time as our custom pull-to-refresh gesture on the Posts feed */}
      {/* pt reserves --app-banner-height (banner + safe-area) so page content always starts
          right below the (now taller-on-notched-devices) banner below */}
      <body className="min-h-full flex flex-col bg-chalk text-gray-900 dark:bg-gray-950 dark:text-white pt-[var(--app-banner-height)] relative overscroll-y-contain">

        {/* GLOBAL MOBILE APP LAUNCH STICKY BANNER - hides itself on native, see AppBanner.tsx */}
        <AppBanner />

        {/* Wrapped the entire application in your new theme Providers */}
        <Providers>
          <GoogleOAuthProvider clientId={clientId}>
            {children}
          </GoogleOAuthProvider>
        </Providers>

      </body>
    </html>
  );
}