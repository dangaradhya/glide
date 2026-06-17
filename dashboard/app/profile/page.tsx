// app/profile/page.tsx

"use client";

// 1. IMPORTS
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthButton from '@/components/AuthButton';
// Import the ThemeToggle component
import ThemeToggle from '@/components/ThemeToggle';

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
  const [userProfile, setUserProfile] = useState<{ name: string; picture: string; email: string } | null>(null);

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

      setUserProfile(JSON.parse(userStr));

      try {
        const res = await fetch('http://localhost:3000/api/users/me/vault', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          setVault(data);
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

  // 4. RENDER HELPERS
  const activeData = vault[activeTab];

  return (
    // Dynamic bg-gray-100/bg-gray-950 classes for Light/Dark mode
    // Injected pt-[max(1rem,env(safe-area-inset-top))] to clear the device notch
    <main className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 pt-[max(1rem,env(safe-area-inset-top))] transition-colors duration-300">
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
            <div className="flex flex-col items-center mb-12 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-md dark:shadow-2xl transition-colors">
              <img 
                src={userProfile?.picture} 
                alt="Profile" 
                className="w-24 h-24 rounded-full border-4 border-gray-200 dark:border-gray-800 shadow-lg mb-4"
                referrerPolicy="no-referrer"
              />
              <h1 className="text-3xl font-bold">{userProfile?.name}</h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">{userProfile?.email}</p>
            </div>

            {/* The Tab Navigation */}
            <div className="flex justify-center space-x-2 md:space-x-6 mb-8 border-b border-gray-200 dark:border-gray-800 pb-4 overflow-x-auto scrollbar-hide">
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

                    {/* HIGHLIGHT: Render the Custom Comment Layout */}
                    {item.text && item.post_headline && (
                      <>
                        <div className="flex justify-between items-center mb-4">
                          <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[10px] font-bold px-2.5 py-0.5 rounded uppercase tracking-widest">
                            Comment
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
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-semibold uppercase tracking-wider">On Post:</p>
                          <h3 className="text-sm font-bold line-clamp-2 leading-snug text-gray-700 dark:text-gray-300">
                            {item.post_headline}
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
    </main>
  );
}