"use client";

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

// The "Mobile App coming soon" banner is a web-only marketing message - telling someone
// who's already running the native app that the app is "coming soon" is a non-sequitur.
//
// This defaults to HIDDEN and only shows once client-side JS has explicitly confirmed
// we're on web - the inverse of the earlier "assume web, hide if native" approach.
// Why: this app is a static export (output: 'export'), and the native Android/iOS app
// ships that exact same static HTML/JS bundle (see capacitor.config.ts's webDir) - there
// is no way to know at build time whether a given copy of the static output will end up
// viewed on the website or wrapped in the native shell. Any check computed "as early as
// possible" during the first render can only be correct in one of those two contexts.
// Defaulting to hidden means native's first paint (and the pre-hydration static HTML in
// general) can never contain the banner, full stop - the cost moves to web, where the
// banner now appears slightly after first paint instead of being baked into the static
// output, which is a far more acceptable trade-off than incorrect marketing content
// showing inside the native app. Matches the same "mounted" pattern already used
// elsewhere in this codebase for client-only UI (see ThemeToggle.tsx, AuthButton.tsx).
export default function AppBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      document.documentElement.style.setProperty('--app-banner-height', 'var(--app-safe-top)');
    } else {
      setShowBanner(true);
    }
  }, []);

  if (!showBanner) return null;

  return (
    <div className="absolute top-0 left-0 w-full h-[var(--app-banner-height)] pt-[var(--app-safe-top)] bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white z-[99999] flex items-center justify-center px-4 shadow-md text-xs sm:text-sm font-semibold tracking-wide select-none">
      <span className="flex items-center gap-2">
        <span className="inline-block animate-pulse w-2 h-2 rounded-full bg-green-400"></span>
        Mobile App coming soon to iOS & Android!
      </span>
    </div>
  );
}
