// components/Brand.tsx
//
// Shared "Glide" wordmark, previously a gradient <h1> hand-copied across four page
// headers (posts / match center / match detail / profile). Styling lives in
// globals.css (.brand-wordmark) - this component only decides whether the glide-in
// animation plays. Deliberately NOT a link: today only the profile header wraps the
// wordmark in a Link, and changing navigation behavior is for later, so call
// sites keep whatever wrapper they already had.
"use client";

import { useEffect, useState } from 'react';

export default function Brand({ className = "" }: { className?: string }) {
  const [animate, setAnimate] = useState(false);

  // The signature glide-in plays once per browser session, not on every client-side
  // tab switch - replaying a 0.7s wordmark animation on each nav reads as lag, not
  // delight. Gated in an effect (same post-hydration pattern as AuthButton/AppBanner)
  // because sessionStorage doesn't exist during the static-export prerender, and a
  // server/client class mismatch would trip React's hydration warning.
  useEffect(() => {
    if (!sessionStorage.getItem('glide_brand_glided')) {
      sessionStorage.setItem('glide_brand_glided', '1');
      setAnimate(true);
    }
  }, []);

  return (
    <h1
      className={`brand-wordmark text-3xl md:text-4xl ${animate ? 'brand-wordmark--animate' : ''} ${className}`.trim()}
    >
      Glide
    </h1>
  );
}
