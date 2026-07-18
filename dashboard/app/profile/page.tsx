// app/profile/page.tsx
"use client";

// 1. IMPORTS
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthButton from '@/components/AuthButton';
// Import the ThemeToggle component
import ThemeToggle from '@/components/ThemeToggle';
// Shared API client - base URL + auto-attached auth header, see lib/api.ts
import { apiFetch } from '@/lib/api';
import BottomNav from '@/components/BottomNav';
import Brand from '@/components/Brand';

// The main ProfileVault component that displays the user's liked/saved posts and reels in a tabbed interface
export default function ProfileVault() {
  // 2. STATE MANAGEMENT
  const [loading, setLoading] = useState(true);
  
  // Added 'userComments' to the activeTab type
  const [activeTab, setActiveTab] = useState<'likedPosts' | 'savedPosts' | 'likedReels' | 'savedReels' | 'userComments'>('likedPosts');
  
  // The master state holding all arrays from the backend
  const [vault, setVault] = useState({
    likedPosts: [],
    savedPosts: [],
    likedReels: [],
    savedReels: [],
    userComments: []
  });

  // State to hold user profile information for display in the header
  const [userProfile, setUserProfile] = useState<{ id: number | string; name: string; picture: string; email: string } | null>(null);

  // Toggles editing mode and maintains text fields for profile overrides
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState("");
  
  const [editPicture, setEditPicture] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  // Inline validation message for edit mode (bad file type / too large / empty name),
  // shown under the avatar instead of a blocking alert()
  const [editError, setEditError] = useState("");

  // Scroll-to-top button state
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Scroll listener to toggle the button visibility when the user scrolls down 400px
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 400) {
        setShowScrollTop(true);
      } else {
        setShowScrollTop(false);
      }
    };

    // Add the scroll event listener when the component mounts and clean it up on unmount
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Smooth scroll action for the button - scrolls the user back to the top of the page
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 3. DATA FETCHING
  useEffect(() => {
    const fetchVaultData = async () => {
      const token = localStorage.getItem('glide_token');
      const userStr = localStorage.getItem('glide_user');
      
      // If they aren't logged in, redirect them home
      if (!token || !userStr) {
        window.location.href = '/';
        return;
      }

      const parsedUser = JSON.parse(userStr);
      setUserProfile(parsedUser);
      // Pre-fill input variables in case they click edit
      setEditName(parsedUser.name || "");
      setEditPicture(parsedUser.picture || "");

      try {
        const res = await apiFetch('/api/users/me/vault');

        if (res.ok) {
          const data = await res.json();
          
          // Merge Post Comments and Reel Comments into a single unified array, 
          // then sort them in descending order (newest first) using their UTC timestamps.
          const combinedComments = [...(data.userComments || []), ...(data.userReelComments || [])]
            .sort((a, b) => new Date(b.timestamp + 'Z').getTime() - new Date(a.timestamp + 'Z').getTime());

          setVault({
            ...data,
            userComments: combinedComments 
          });
        } else if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('glide_token');
            localStorage.removeItem('glide_user');
            window.location.href = '/';
        }
      } catch (error) {
        console.error("Failed to fetch vault:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchVaultData();
  }, []);

  // Processes raw native browser file buffers into string blocks safely
  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      return setEditError("That file isn't an image — use a PNG or JPG.");
    }
    if (file.size > 2 * 1024 * 1024) {
      return setEditError("Image is over 2MB — pick a smaller one.");
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setEditPicture(e.target.result as string);
        setEditError("");
      }
    };
    reader.readAsDataURL(file);
  };

  // Abandon unsaved edits: restore the inputs from the last-saved profile so the
  // next visit to edit mode doesn't start from stale, half-changed values
  const handleCancelEdit = () => {
    setEditName(userProfile?.name || "");
    setEditPicture(userProfile?.picture || "");
    setEditError("");
    setIsEditingProfile(false);
  };

  // PROFILE PERSISTENCE SAVE HANDLER
  const handleSaveProfile = async () => {
    if (!editName.trim()) return setEditError("Add a display name before saving.");
    
    // We fall back to a blank string if ID is missing to guarantee the type matches our interface
    const currentId = userProfile?.id || "";
    
    const updatedProfile = {
      id: currentId,
      name: editName,
      picture: editPicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(editName)}&background=random`,
      email: userProfile?.email || ""
    };

    // Update the local machine instantly so the app feels incredibly fast
    localStorage.setItem('glide_user', JSON.stringify(updatedProfile));

    setUserProfile(updatedProfile);
    setIsEditingProfile(false);

    // Send the new profile data to the Express backend in the background
    const token = localStorage.getItem('glide_token');
    if (token) {
      try {
        const res = await apiFetch('/api/users/me/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: updatedProfile.name, picture: updatedProfile.picture })
        });
        // A freshly-uploaded picture was sent as base64 - the server uploads it to R2 and
        // hands back the resulting URL. Swap it into localStorage so we never permanently
        // cache a multi-megabyte data URL client-side once the real URL is known.
        const data = await res.json();
        if (data.picture && data.picture !== updatedProfile.picture) {
          const syncedProfile = { ...updatedProfile, picture: data.picture };
          localStorage.setItem('glide_user', JSON.stringify(syncedProfile));
        }
      } catch (err) {
        console.error("Failed to sync profile to server", err);
      }
    }

    // Force a minor page reload layout step to update your top right navbar AuthButton avatar cleanly
    window.location.reload();
  };

  // 4. RENDER HELPERS
  const activeData = vault[activeTab];

  // Header activity strip, computed from the vault already in hand. Rendered only
  // once there's something to count - a row of zeros advertises emptiness.
  const likedCount = vault.likedPosts.length + vault.likedReels.length;
  const savedCount = vault.savedPosts.length + vault.savedReels.length;
  const commentCount = vault.userComments.length;
  const hasActivity = likedCount + savedCount + commentCount > 0;

  // Empty tabs invite action instead of announcing absence - each one links to
  // where that kind of item actually gets created.
  const EMPTY_STATES: Record<typeof activeTab, { heading: string; body: string; cta: string; href: string }> = {
    likedPosts: { heading: 'Nothing liked yet', body: 'Tap the heart on any post to keep it here.', cta: 'Browse posts', href: '/' },
    savedPosts: { heading: 'No saved posts', body: 'Bookmark a post to come back to it later.', cta: 'Browse posts', href: '/' },
    likedReels: { heading: 'No liked reels', body: 'Like a highlight to keep it in your vault.', cta: 'Watch reels', href: '/reels' },
    savedReels: { heading: 'No saved reels', body: 'Save a highlight to watch it again anytime.', cta: 'Watch reels', href: '/reels' },
    userComments: { heading: 'No comments yet', body: 'Join the conversation on any post or reel.', cta: 'Browse posts', href: '/' },
  };
  const emptyState = EMPTY_STATES[activeTab];

  return (
    // Dynamic bg-gray-100/bg-gray-950 classes for Light/Dark mode
    // No extra top padding needed here for the notch - <body>'s pt-[var(--app-banner-height)]
    // (see layout.tsx) already reserves that space for every page. Adding it again here
    // would double-count the notch inset on top of what body already reserves.
    <main className="min-h-screen bg-chalk dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 relative">
      <div className="max-w-6xl mx-auto pb-[calc(6rem_+_var(--app-safe-bottom))] md:pb-8">

        {/* Header Section - Text-only header matching the other pages */}
        <div className="flex items-center justify-between mb-12">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <Brand />
          </Link>
          {/* Added ThemeToggle next to the AuthButton */}
          <div className="flex items-center gap-2 md:gap-4">
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center mt-32">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <>
            {/* User Profile Header */}
            {/* Dynamic background, borders, and shadows for Light/Dark mode */}
            {/* Reduced padding, margin, avatar size, and font sizes for mobile. Scales up at md: breakpoint. */}
            <div className="w-full max-w-2xl mx-auto mb-8 md:mb-12 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 md:p-8 shadow-md dark:shadow-2xl transition-colors relative overflow-hidden">
              {/* Soft Court-Purple identity wash behind the avatar - a tint, not a cover photo */}
              <div
                className="absolute inset-x-0 top-0 h-32 pointer-events-none bg-[radial-gradient(ellipse_at_top,rgba(147,51,234,0.10),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.14),transparent_70%)]"
                aria-hidden="true"
              ></div>

              {isEditingProfile ? (
                // Edit mode mirrors the read-mode layout: the avatar itself is the
                // picture control (click to browse, drop an image straight onto it)
                // and the name edits in place - no separate boxy form panel.
                <div className="flex flex-col items-center relative">
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleImageFile(e.dataTransfer.files[0]);
                      }
                    }}
                    className="relative mb-3 md:mb-4"
                  >
                    <label className="cursor-pointer block group" aria-label="Change profile picture">
                      {editPicture ? (
                        <img
                          src={editPicture}
                          alt="Profile preview"
                          className={`w-20 h-20 md:w-28 md:h-28 rounded-full object-cover shadow-lg transition-all border-2 md:border-4 ${
                            isDragging ? 'border-purple-500 scale-105' : 'border-purple-500/30 group-hover:border-purple-500/60'
                          }`}
                        />
                      ) : (
                        <div className={`w-20 h-20 md:w-28 md:h-28 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center shadow-lg transition-all border-2 md:border-4 border-dashed ${
                          isDragging ? 'border-purple-500 scale-105' : 'border-gray-300 dark:border-gray-700 group-hover:border-purple-500/60'
                        }`}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      {/* Camera badge - signals the avatar is the tap target */}
                      <span className="absolute bottom-0 right-0 md:bottom-1 md:right-1 w-7 h-7 rounded-full bg-court text-white flex items-center justify-center shadow-md border-2 border-white dark:border-gray-900 group-hover:bg-signal transition-colors" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleImageFile(e.target.files[0]);
                          }
                        }}
                      />
                    </label>
                  </div>

                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
                    Click the photo or drop an image — PNG or JPG, up to 2MB
                  </p>
                  {editPicture && (
                    <button
                      type="button"
                      onClick={() => setEditPicture("")}
                      className="text-[11px] font-semibold text-gray-400 hover:text-red-500 transition-colors mb-2"
                    >
                      Remove photo
                    </button>
                  )}

                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveProfile();
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    placeholder="Display name"
                    autoFocus
                    className="font-display font-stretch-[105%] font-extrabold text-2xl md:text-3xl text-center bg-transparent border-b-2 border-gray-200 dark:border-gray-700 focus:border-purple-500 outline-none w-full max-w-xs pb-1 mt-1 transition-colors placeholder:text-gray-300 dark:placeholder:text-gray-600 placeholder:font-normal"
                  />
                  <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-2 text-center">{userProfile?.email}</p>

                  {editError && (
                    <p className="text-xs font-semibold text-red-500 mt-3" role="alert">{editError}</p>
                  )}

                  <div className="flex space-x-3 mt-5">
                    <button
                      onClick={handleSaveProfile}
                      className="px-6 py-2 text-sm font-bold bg-court text-white rounded-full hover:bg-signal transition-colors shadow-md active:scale-95"
                    >
                      Save changes
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="px-6 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-700 hover:border-purple-400 hover:text-court dark:hover:text-signal transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                // Standard Profile Read Mode
                <div className="flex flex-col items-center relative">
                  <button
                    onClick={() => setIsEditingProfile(true)}
                    className="absolute top-0 right-0 text-xs font-bold text-court hover:text-signal dark:text-purple-400 dark:hover:text-purple-300 bg-purple-500/10 px-3 py-1.5 rounded-full border border-purple-500/20 transition-all active:scale-95"
                  >
                    Edit profile
                  </button>
                  <img
                    src={userProfile?.picture}
                    alt="Profile"
                    className="w-16 h-16 md:w-24 md:h-24 rounded-full border-2 md:border-4 border-purple-500/30 shadow-lg mb-3 md:mb-4 object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <h1 className="font-display font-stretch-[105%] font-extrabold text-2xl md:text-3xl text-center">{userProfile?.name}</h1>
                  <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1 text-center">{userProfile?.email}</p>
                  {hasActivity && (
                    <p className="font-display font-stretch-[72%] font-semibold uppercase tracking-[0.09em] text-[11px] text-gray-400 dark:text-gray-500 mt-3 tabular-nums">
                      {likedCount} liked · {savedCount} saved · {commentCount} comment{commentCount === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* The Tab Navigation */}
            <div className="flex justify-start md:justify-center space-x-2 md:space-x-6 mb-8 border-b border-gray-200 dark:border-gray-800 pb-4 px-2 overflow-x-auto scrollbar-hide w-full">
              {[
                { id: 'likedPosts', label: 'Liked Posts' },
                { id: 'savedPosts', label: 'Saved Posts' },
                { id: 'likedReels', label: 'Liked Reels' },
                { id: 'savedReels', label: 'Saved Reels' },
                { id: 'userComments', label: 'My Comments' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  // Voice B condensed caps; the active pill is brand purple (this was the
                  // one interactive surface in the app styled as a black/white inversion)
                  className={`px-4 py-2 font-display font-stretch-[72%] font-semibold uppercase tracking-[0.07em] text-[13px] md:text-sm rounded-full transition-all whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-court text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-900'
                  }`}
                >
                  {tab.label}
                  {/* Zero-count badges hide rather than advertise emptiness */}
                  {(vault[tab.id as keyof typeof vault]?.length || 0) > 0 && (
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full tabular-nums ${activeTab === tab.id ? 'bg-white/25 text-white' : 'bg-gray-200 dark:bg-gray-800/50'}`}>
                      {vault[tab.id as keyof typeof vault].length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* The Grid Display */}
            {activeData.length === 0 ? (
              <div className="flex flex-col items-center text-center py-16 md:py-20">
                <h3 className="font-display font-stretch-[105%] font-bold text-xl mb-1.5">{emptyState.heading}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs">{emptyState.body}</p>
                <Link
                  href={emptyState.href}
                  className="px-6 py-2.5 text-sm font-bold bg-court text-white rounded-full hover:bg-signal transition-colors shadow-md active:scale-95"
                >
                  {emptyState.cta}
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {activeData.map((item: any) => (
                  // Dynamic card backgrounds matching the main feed
                  <div key={item.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-md dark:shadow-lg flex flex-col h-full group hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
                    
                    {/* Render Post Layout */}
                    {item.headline && !item.text && (
                      <>
                        <div className="flex justify-between items-center mb-3">
                          <span className="bg-court/10 dark:bg-court/20 text-court dark:text-signal font-display font-stretch-[72%] font-semibold text-[11px] px-2.5 py-0.5 rounded-full uppercase tracking-[0.08em]">
                            {item.sport_category}
                          </span>
                        </div>
                        {item.image_url && (
                          <div className="w-full h-32 rounded-lg overflow-hidden mb-4 bg-gray-200 dark:bg-gray-800 relative">
                            <img src={item.image_url} alt={item.headline} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                          </div>
                        )}
                        <h3 className="text-md font-bold mb-2 line-clamp-2 leading-tight">{item.headline}</h3>
                        <div className="mt-auto pt-4 flex justify-between items-center">
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300 font-bold">
                            Read original &rarr;
                          </a>
                        </div>
                      </>
                    )}

                    {/* Render Reel Layout */}
                    {item.video_id && (
                    // Wrap the Reel card in a Link that points to the Reels page
                    <Link href={`/reels?reelId=${item.video_id}`}>
                        <div className="w-full h-48 rounded-lg overflow-hidden mb-4 bg-black relative cursor-pointer hover:opacity-90 transition-opacity">
                            <img src={`https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg`} alt={item.title} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="bg-black/50 p-3 rounded-full backdrop-blur-sm">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                        <h3 className="text-md font-bold mb-1 line-clamp-2 leading-tight">{item.title}</h3>
                        <p className="text-xs text-gray-400 mt-auto font-medium">@{item.channel_name}</p>
                    </Link>
                    )}

                    {/* Render the Unified Comment Layout handling both Posts and Reels */}
                    {item.text && (item.post_headline || item.reel_title) && (
                      <>
                        <div className="flex justify-between items-center mb-4">
                          <span className={`font-display font-stretch-[72%] font-semibold text-[11px] px-2.5 py-0.5 rounded-full uppercase tracking-[0.08em] ${item.reel_title ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-court/10 dark:bg-court/20 text-court dark:text-signal'}`}>
                            {item.reel_title ? 'Reel comment' : 'Post comment'}
                          </span>
                          <span className="text-gray-400 dark:text-gray-500 text-xs">
                            {new Date(item.timestamp + 'Z').toLocaleDateString()}
                          </span>
                        </div>
                        
                        {/* The comment itself - a clean brand-purple quote bar instead of a speech bubble */}
                        <blockquote className="border-l-2 border-court pl-4 py-1 mb-4">
                          <p className="text-sm text-gray-800 dark:text-gray-200 font-medium break-words">
                            {item.text}
                          </p>
                        </blockquote>

                        {/* The Context of what they commented on */}
                        <div className="mt-auto border-t border-gray-100 dark:border-gray-800 pt-3">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-semibold uppercase tracking-wider">
                            On {item.reel_title ? 'Highlight' : 'Post'}:
                          </p>
                          <h3 className="text-sm font-bold line-clamp-2 leading-snug text-gray-700 dark:text-gray-300">
                            {item.post_headline || item.reel_title}
                          </h3>
                        </div>
                      </>
                    )}

                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile Bottom Navigation Bar (Hidden on Desktop) */}
      <BottomNav active="profile" />

      {/* Positioned bottom right. Only visible when scrolled past 400px. Animated entry/hover */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 md:bottom-10 md:right-10 bg-purple-600 hover:bg-purple-500 text-white p-3 rounded-full shadow-2xl transition-all hover:scale-110 active:scale-95 z-50 group"
          aria-label="Scroll to top"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 group-hover:-translate-y-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

    </main>
  );
}