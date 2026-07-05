// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
// Integrated Google OAuth Provider for Authentication
import { GoogleOAuthProvider } from '@react-oauth/google'; 
import "./globals.css";
// Import your theme provider
import { Providers } from './providers';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Upgraded the metadata for Browser Tabs, SEO, and Social Sharing
export const metadata: Metadata = {
  title: "Glide", 
  description: "AI-Powered Sports Aggregator & Highlight Reels",
  // Added PWA configuration for native app deployment
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Glide",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Added light/dark default background and text colors, plus a smooth CSS transition */}
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white pt-[40px] relative">
        
        {/* GLOBAL MOBILE APP LAUNCH STICKY BANNER */}
        <div className="absolute top-0 left-0 w-full h-[40px] bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white z-[99999] flex items-center justify-center px-4 shadow-md text-xs sm:text-sm font-semibold tracking-wide select-none">
          <span className="flex items-center gap-2">
            <span className="inline-block animate-pulse w-2 h-2 rounded-full bg-green-400"></span>
            Mobile App coming soon to iOS & Android!
          </span>
        </div>

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