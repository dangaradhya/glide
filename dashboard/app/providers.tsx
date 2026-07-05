// app/providers.tsx
"use client";

// IMPORTS
import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import posthog from "posthog-js";
import { PostHogProvider } from "@posthog/react";

// The Providers component wraps the entire application with necessary context providers, such as ThemeProvider for theming support. 
export function Providers({ children }: { children: React.ReactNode }) {
  
  // INITIALIZE POSTHOG CLIENT CONTEXT
  useEffect(() => {
    if (typeof window !== 'undefined') {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true
      });
    }
  }, []);

  // We wrap the children in the ThemeProvider, which provides theming capabilities (like dark mode) to the entire application.
  // The ThemeProvider is configured to use the 'class' strategy for dark mode, with a default theme of 'system' that follows the user's OS preference.
  // The enableSystem prop allows the theme to automatically switch based on the user's system settings.
  return (
    <PostHogProvider client={posthog}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
      </ThemeProvider>
    </PostHogProvider>
  );
}