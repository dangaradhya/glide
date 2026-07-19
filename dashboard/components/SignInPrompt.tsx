// components/SignInPrompt.tsx
//
// The sleek replacement for the browser alert() that used to gate liking/saving/
// commenting for signed-out users. Purely presentational - it owns ZERO auth
// logic. Its "Sign in" CTA either rings AuthButton's doorbell (a CustomEvent
// AuthButton listens for - the real modal and every OAuth handler stay in
// AuthButton untouched) or, on pages without an AuthButton in the layout
// (Reels), navigates to a page that has one via signInHref.
//
// Each page owns one instance with local state:
//   const [signInPrompt, setSignInPrompt] = useState<SignInPromptContent | null>(null);
//   ...
//   setSignInPrompt(SIGN_IN_PROMPTS.like);            // instead of alert()
//   ...
//   <SignInPrompt prompt={signInPrompt} onClose={() => setSignInPrompt(null)} />
"use client";

import React, { useEffect } from 'react';

export interface SignInPromptContent {
  title: string;
  body: string;
}

// The standard gate messages, shared so Posts/Reels/Match Center phrase them
// identically. Like/save name their surface ("...like posts", "...like reels")
// so the title reads complete on its own. No comment prompt: the signed-out
// comment drawer already swaps its input for "Sign in to join the
// conversation", which says it all in place. Session-expired callers clear
// storage themselves first - this component never touches auth state.
export const SIGN_IN_PROMPTS = {
  likePosts: { title: 'Sign in to like posts', body: 'Likes live in your Vault, so you can always find your way back to them.' },
  savePosts: { title: 'Sign in to save posts', body: 'Saved posts live in your Vault, ready when you are.' },
  likeReels: { title: 'Sign in to like reels', body: 'Likes live in your Vault, so you can always find your way back to them.' },
  saveReels: { title: 'Sign in to save reels', body: 'Saved reels live in your Vault, ready when you are.' },
  expired: { title: 'Session expired', body: 'Sign in again to pick up where you left off.' },
} satisfies Record<string, SignInPromptContent>;

// Set just before a signInHref navigation so the destination's AuthButton
// opens the sign-in modal on arrival instead of stranding the user on the
// home feed wondering what happened.
export const OPEN_AUTH_ON_LOAD_KEY = 'glide_open_auth_on_load';

export default function SignInPrompt({ prompt, onClose, signInHref }: {
  prompt: SignInPromptContent | null;
  onClose: () => void;
  // Set on pages whose layout has no AuthButton (Reels): the CTA navigates
  // there instead of dispatching the open-auth event into the void
  signInHref?: string;
}) {
  // Escape closes, matching what people expect from a 2026 modal
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, onClose]);

  if (!prompt) return null;

  const handleSignIn = () => {
    if (signInHref) {
      try { sessionStorage.setItem(OPEN_AUTH_ON_LOAD_KEY, '1'); } catch { /* private mode - plain nav still works */ }
      window.location.href = signInHref;
      return;
    }
    onClose();
    window.dispatchEvent(new CustomEvent('glide:open-auth'));
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={prompt.title}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-[#0F1117] rounded-3xl p-7 border border-gray-200 dark:border-white/10 shadow-2xl text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-court/10 dark:bg-signal/15 flex items-center justify-center" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-court dark:text-signal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight mb-1.5">
          {prompt.title}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
          {prompt.body}
        </p>

        <button
          onClick={handleSignIn}
          className="w-full py-2.5 rounded-full font-bold text-sm bg-court hover:bg-signal text-white transition-colors shadow-md active:scale-[0.98]"
        >
          Sign in
        </button>
        <button
          onClick={onClose}
          className="w-full mt-2 py-2 text-sm font-semibold text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
