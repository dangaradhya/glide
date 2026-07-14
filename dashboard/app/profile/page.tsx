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
      return alert("Please drop a valid image file!");
    }
    if (file.size > 2 * 1024 * 1024) {
      return alert("Image must be smaller than 2MB to keep performance fast!");
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setEditPicture(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  // PROFILE PERSISTENCE SAVE HANDLER
  const handleSaveProfile = async () => {
    if (!editName.trim()) return alert("Name cannot be empty!");
    
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
        await apiFetch('/api/users/me/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: updatedProfile.name, picture: updatedProfile.picture })
        });
      } catch (err) {
        console.error("Failed to sync profile to server", err);
      }
    }

    // Force a minor page reload layout step to update your top right navbar AuthButton avatar cleanly
    window.location.reload();
  };

  // 4. RENDER HELPERS
  const activeData = vault[activeTab];

  return (
    // Dynamic bg-gray-100/bg-gray-950 classes for Light/Dark mode
    // No extra top padding needed here for the notch - <body>'s pt-[var(--app-banner-height)]
    // (see layout.tsx) already reserves that space for every page. Adding it again here
    // would double-count the notch inset on top of what body already reserves.
    <main className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 relative">
      <div className="max-w-6xl mx-auto">
        
        {/* Header Section - Text-only header matching the other pages */}
        <div className="flex items-center justify-between mb-12">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
              Glide
            </h1>
          </Link>
          {/* Added ThemeToggle next to the AuthButton */}
          <div className="flex items-center space-x-4">
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
            <div className="w-full max-w-2xl mx-auto mb-8 md:mb-12 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 md:p-8 shadow-md dark:shadow-2xl transition-colors relative">
              {isEditingProfile ? (
                // Editing Layout Panel
                <div className="flex flex-col space-y-4 w-full">
                  <h2 className="text-xl font-bold border-b border-gray-100 dark:border-gray-800 pb-2 mb-2">Edit Profile Setup</h2>
                  
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Display Name</label>
                    <input 
                      type="text" 
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none w-full"
                    />
                  </div>

                  {/* INTERACTIVE DRAG-AND-DROP FILE DROPZONE */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Profile Picture</label>
                    
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
                      className={`w-full border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center transition-all ${
                        isDragging 
                          ? 'border-purple-500 bg-purple-500/10' 
                          : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/20 hover:bg-gray-100/50 dark:hover:bg-gray-800/30'
                      }`}
                    >
                      {editPicture ? (
                        <div className="flex items-center space-x-4 w-full px-2">
                          <img src={editPicture} alt="Preview" className="w-14 h-14 rounded-full object-cover shadow border border-white/20 shrink-0" />
                          <div className="text-left flex-1 min-w-0">
                            <p className="text-sm font-semibold text-green-500">Image uploaded successfully</p>
                            <p className="text-xs text-gray-400 truncate">Ready to save</p>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setEditPicture("")}
                            className="text-xs text-red-500 font-bold hover:underline bg-red-500/10 px-2.5 py-1 rounded-md"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center cursor-pointer w-full h-full">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                            Drag & drop a image, or <span className="text-purple-500 underline">browse</span>
                          </span>
                          <span className="text-[10px] text-gray-400 mt-1">Supports PNG, JPG up to 2MB</span>
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
                      )}
                    </div>
                  </div>

                  <div className="flex space-x-3 pt-2">
                    <button 
                      onClick={handleSaveProfile} 
                      className="px-5 py-2 text-xs font-bold bg-purple-600 text-white rounded-full hover:bg-purple-500 transition-colors shadow-md"
                    >
                      Save Changes
                    </button>
                    <button 
                      onClick={() => setIsEditingProfile(false)} 
                      className="px-5 py-2 text-xs font-semibold bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-full hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                // Standard Profile Read Mode
                <div className="flex flex-col items-center">
                  <button 
                    onClick={() => setIsEditingProfile(true)}
                    className="absolute top-5 right-5 text-xs font-bold text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300 bg-purple-500/10 px-3 py-1.5 rounded-full border border-purple-500/20 transition-all active:scale-95"
                  >
                    Edit Profile
                  </button>
                  <img 
                    src={userProfile?.picture} 
                    alt="Profile" 
                    className="w-16 h-16 md:w-24 md:h-24 rounded-full border-2 md:border-4 border-gray-200 dark:border-gray-800 shadow-lg mb-3 md:mb-4 object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <h1 className="text-2xl md:text-3xl font-bold text-center">{userProfile?.name}</h1>
                  <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1 text-center">{userProfile?.email}</p>
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
                  className={`px-4 py-2 font-bold text-sm md:text-base rounded-full transition-all whitespace-nowrap ${
                    activeTab === tab.id 
                      // Specific active tab styles for light and dark modes
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-black' 
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-900'
                  }`}
                >
                  {tab.label} <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-gray-700 dark:bg-gray-200' : 'bg-gray-200 dark:bg-gray-800/50'}`}>{vault[tab.id as keyof typeof vault]?.length || 0}</span>
                </button>
              ))}
            </div>

            {/* The Grid Display */}
            {activeData.length === 0 ? (
              <div className="text-center py-20 text-gray-500 dark:text-gray-400 font-medium">
                No items found in this section yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                
                {activeData.map((item: any) => (
                  // Dynamic card backgrounds matching the main feed
                  <div key={item.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 shadow-md dark:shadow-lg flex flex-col h-full group hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
                    
                    {/* Render Post Layout */}
                    {item.headline && !item.text && (
                      <>
                        <div className="flex justify-between items-center mb-3">
                          <span className="bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-widest">
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
                            Read Original &rarr;
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
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded uppercase tracking-widest ${item.reel_title ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'}`}>
                            {item.reel_title ? 'Reel Comment' : 'Post Comment'}
                          </span>
                          <span className="text-gray-400 dark:text-gray-500 text-xs">
                            {new Date(item.timestamp + 'Z').toLocaleDateString()}
                          </span>
                        </div>
                        
                        {/* The Comment Bubble */}
                        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-4 rounded-xl rounded-tl-none mb-4 relative">
                          <svg className="w-6 h-6 text-gray-200 dark:text-gray-700 absolute -top-3 -left-1 transform -rotate-12" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M10 3a1 1 0 01.832.445l8 12a1 1 0 01-.832 1.555h-16a1 1 0 01-.832-1.555l8-12A1 1 0 0110 3z" />
                          </svg>
                          <p className="text-sm text-gray-800 dark:text-gray-200 font-medium italic relative z-10 break-words">
                            "{item.text}"
                          </p>
                        </div>

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