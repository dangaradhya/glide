"use client";

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

// The "Mobile App coming soon" banner is a web-only marketing message - telling someone
// who's already running the native app that the app is "coming soon" is a non-sequitur.
// This hides the banner on native AND collapses --app-banner-height down to JUST
// var(--app-safe-top) (notch/status-bar clearance only, no banner) in the same effect -
// never a flat 0px, since native content still has to clear the notch even without the
// banner.
//
// isNative starts from a lazy useState initializer (not a plain useEffect) so the
// correct render happens on the very first paint in the common case - no one-frame
// flash of the banner on native cold boot. But Capacitor.isNativePlatform() can race
// against the native bridge's own injection into the WebView: called too early (before
// the bridge has finished initializing), it can incorrectly report false even when
// genuinely running in the native app - confirmed on a real device, not hypothetical.
// The effect below re-checks after mount (by which point the bridge has definitely had
// time to settle) and self-corrects if the initial synchronous check got it wrong.
export default function AppBanner() {
  const [isNative, setIsNative] = useState(() => Capacitor.isNativePlatform());

  useEffect(() => {
    const reallyNative = Capacitor.isNativePlatform();
    if (reallyNative !== isNative) {
      setIsNative(reallyNative);
    }
    if (reallyNative) {
      document.documentElement.style.setProperty('--app-banner-height', 'var(--app-safe-top)');
    }
  }, [isNative]);

  if (isNative) return null;

  return (
    <div className="absolute top-0 left-0 w-full h-[var(--app-banner-height)] pt-[var(--app-safe-top)] bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white z-[99999] flex items-center justify-center px-4 shadow-md text-xs sm:text-sm font-semibold tracking-wide select-none">
      <span className="flex items-center gap-2">
        <span className="inline-block animate-pulse w-2 h-2 rounded-full bg-green-400"></span>
        Mobile App coming soon to iOS & Android!
      </span>
    </div>
  );
}
