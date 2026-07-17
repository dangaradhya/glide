"use client";

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

// The "coming soon" banner is a web-only marketing message - telling someone
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
// The 40px always-on gradient billboard became a 32px quiet
// strip in the design language's condensed-caps voice, and it's now dismissible.
// Dismissal persists in localStorage and collapses --app-banner-height to just the
// safe-area inset - the exact same override native uses, so every consumer of that
// variable (body padding, Reels' viewport lock) stays in sync for free. Like the
// native check, the dismissed check runs post-hydration, so a returning dismisser
// sees the reserved space collapse just after first paint rather than never - the
// same accepted trade-off as above.
const DISMISS_KEY = 'glide_banner_dismissed';

export default function AppBanner() {
  const [showBanner, setShowBanner] = useState(false);

  const collapseReservedSpace = () => {
    document.documentElement.style.setProperty('--app-banner-height', 'var(--app-safe-top)');
  };

  useEffect(() => {
    if (Capacitor.isNativePlatform() || localStorage.getItem(DISMISS_KEY)) {
      collapseReservedSpace();
    } else {
      setShowBanner(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    collapseReservedSpace();
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="absolute top-0 left-0 w-full h-[var(--app-banner-height)] pt-[var(--app-safe-top)] bg-chalk dark:bg-ink border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 z-[99999] flex items-center justify-center px-4 select-none">
      <span className="flex items-center gap-2 font-display font-stretch-[72%] font-semibold uppercase tracking-[0.09em] text-[11px]">
        <span className="inline-block animate-pulse w-1.5 h-1.5 rounded-full bg-live"></span>
        Glide for iOS &amp; Android — coming soon
      </span>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss banner"
        className="absolute right-3 top-1/2 -translate-y-1/2 mt-[calc(var(--app-safe-top)/2)] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-base leading-none p-1"
      >
        ×
      </button>
    </div>
  );
}
