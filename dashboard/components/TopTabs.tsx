// components/TopTabs.tsx
//
// Shared desktop navigation tabs (hidden on mobile, where BottomNav takes over),
// previously hand-copied across four pages (posts / reels / match center / match
// detail). Adds Profile as a 4th tab - mobile's BottomNav already had it, so this
// closes the gap where desktop users could only reach Profile via the header
// avatar. Labels use Voice B of the design language (condensed caps) with the
// established purple active underline.
"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';

type TopTab = 'posts' | 'reels' | 'match_center' | 'profile';

const TABS: { id: TopTab; href: string; label: string }[] = [
  { id: 'posts', href: '/', label: 'Posts' },
  { id: 'reels', href: '/reels', label: 'Reels' },
  { id: 'match_center', href: '/match_center', label: 'Match Center' },
  { id: 'profile', href: '/profile', label: 'Profile' },
];

const VOICE_B = "font-display font-stretch-[72%] font-semibold uppercase tracking-[0.09em] text-base pb-1 whitespace-nowrap";

export default function TopTabs({ active, className = "" }: { active?: TopTab; className?: string }) {
  // Profile is a dead tab when logged out (the page just bounces to home), so it
  // only renders once a token is confirmed - post-hydration, same pattern as
  // AuthButton, since the static prerender can't know the auth state
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(!!localStorage.getItem('glide_token'));
  }, []);
  const tabs = authed ? TABS : TABS.filter(t => t.id !== 'profile');

  return (
    <div className={`hidden md:flex justify-center gap-8 ${className}`.trim()}>
      {tabs.map((tab) =>
        tab.id === active ? (
          <span key={tab.id} className={`${VOICE_B} text-gray-900 dark:text-white border-b-2 border-court cursor-default`}>
            {tab.label}
          </span>
        ) : (
          <Link
            key={tab.id}
            href={tab.href}
            className={`${VOICE_B} text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors border-b-2 border-transparent`}
          >
            {tab.label}
          </Link>
        )
      )}
    </div>
  );
}
