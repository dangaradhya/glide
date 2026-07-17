// components/BottomNav.tsx
//
// Shared mobile bottom tab bar (Posts / Reels / Match Center / Profile), previously hand-copied
// with drifting styles across app/page.tsx, app/reels/page.tsx, app/match_center/page.tsx,
//  and app/profile/page.tsx. Two visual variants exist on purpose, not by accident:
// "standard" (Posts/Match Center - light/dark-mode-aware, bordered) and "overlay"
// (Reels - always-dark gradient since it sits on top of video content, taller).
"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';

type BottomNavTab = 'posts' | 'reels' | 'match_center' | 'profile';

const TABS: { id: BottomNavTab; href: string; label: string }[] = [
  { id: 'posts', href: '/', label: 'Posts' },
  { id: 'reels', href: '/reels', label: 'Reels' },
  { id: 'match_center', href: '/match_center', label: 'Match Center' },
  { id: 'profile', href: '/profile', label: 'Profile' },
];

export default function BottomNav({
  active,
  variant = 'standard',
}: {
  active: BottomNavTab;
  variant?: 'standard' | 'overlay';
}) {
  const isOverlay = variant === 'overlay';

  // Profile is a dead tab when logged out (the page just bounces to home), so it
  // only renders once a token is confirmed - post-hydration, same pattern as
  // AuthButton, since the static prerender can't know the auth state
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(!!localStorage.getItem('glide_token'));
  }, []);
  const tabs = authed ? TABS : TABS.filter(t => t.id !== 'profile');

  const containerClass = isOverlay
    ? "md:hidden fixed bottom-0 left-0 w-full bg-gradient-to-t from-black/95 via-black/70 to-transparent flex justify-around items-center h-[calc(72px_+_var(--app-safe-bottom))] z-[60] pb-[var(--app-safe-bottom)] px-4"
    : "md:hidden fixed bottom-0 left-0 w-full bg-white/90 dark:bg-gray-900/90 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 flex justify-around items-center h-[calc(4rem_+_var(--app-safe-bottom))] z-[60] pb-[var(--app-safe-bottom)] px-4";

  const activeClass = isOverlay
    ? "text-white font-bold text-sm flex flex-col items-center pt-2 border-t-2 border-white"
    : "text-gray-900 dark:text-white font-bold text-sm flex flex-col items-center pt-1 border-t-2 border-purple-500";

  const inactiveClass = isOverlay
    ? "text-gray-300 font-bold text-sm hover:text-white transition-colors pt-2"
    : "text-gray-500 dark:text-gray-400 font-bold text-sm hover:text-gray-900 dark:hover:text-white pt-1";

  return (
    <div className={containerClass}>
      {tabs.map((tab) =>
        tab.id === active ? (
          <span key={tab.id} className={activeClass}>
            {tab.label}
          </span>
        ) : (
          <Link key={tab.id} href={tab.href} className={inactiveClass}>
            {tab.label}
          </Link>
        )
      )}
    </div>
  );
}
