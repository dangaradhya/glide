// app/page.tsx

// 1. DIRECTIVE
// Next.js defaults to Server Components. We use "use client" to tell Next.js 
// that this is a dynamic component that needs to run in the user's browser,
// allowing us to use React hooks like useState and useEffect.
"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
// Import your Google Auth and Theme Toggle component for use in the header
import AuthButton from '@/components/AuthButton';
import ThemeToggle from '@/components/ThemeToggle';

export default function Home() {
  // 2. STATE MANAGEMENT
  // Think of state as variables that, when updated, automatically redraw the screen.
  // 'posts' holds the array of data from SQLite. 'loading' gives us a cool UI state.
  // Explicitly defining type as any[] to prevent TypeScript errors.
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('All'); // New state for category filter

  // Pagination State
  const [page, setPage] = useState(1); // Tracks current page
  const [hasMore, setHasMore] = useState(true); // Turns off the button when we hit the end of the DB
  const [loadingMore, setLoadingMore] = useState(false); // Spinner for the Load More button

  // Phase 3 - Share State
  // We track the ID of the post that was copied to show a temporary "Copied!" tooltip
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // 3. THE NETWORK REQUEST 
  // Refactored Fetch Logic to accept a page number
  const fetchPosts = async (pageNum: number) => {
    try {
      // Artificial half-second delay for infinite scroll feel
      if (pageNum > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Grab the token and attach it to the GET request headers
      const token = localStorage.getItem('glide_token');
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      const res = await fetch(`http://localhost:3000/api/posts?page=${pageNum}&limit=5`, { 
        headers 
      });
      const data = await res.json();

      if (data.length === 0) {
        // If the database returns an empty array, we reached the end!
        setHasMore(false);
      } else {
        // Append the new data to the EXISTING array, rather than replacing it.
        // We use a quick filter to ensure React's StrictMode doesn't accidentally render duplicate IDs.
        setPosts(prevPosts => {
          const newPosts = [...prevPosts];
          data.forEach((newPost: any) => {
            if (!newPosts.find(p => p.id === newPost.id)) {
              newPosts.push(newPost);
            }
          });
          return newPosts;
        });
      }
      setLoading(false);
      setLoadingMore(false);
    } catch (err) {
      console.error("Error fetching posts:", err);
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Replaced the interval with a page dependency
  // This runs automatically on initial load (page=1), and whenever the 'page' state changes.
  useEffect(() => {
    fetchPosts(page);
  }, [page]);

  // The Infinite Scroll Observer for the Posts Feed
  useEffect(() => {
    if (!hasMore || loadingMore) return;

      // We create a new IntersectionObserver that watches the "sentinel" div at the bottom 
      // of the feed. When that div comes into view (meaning the user has scrolled to the bottom), 
      // we set 'loadingMore' to true and increment the 'page' state, which triggers a new fetch.
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            setLoadingMore(true);
            setPage((prev) => prev + 1);
          }
        },
        { threshold: 0.1 }
      );

      // We start observing the sentinel element. If it exists, we attach the observer to it.
      // The observer will automatically trigger the callback when the sentinel comes into view.
      const sentinel = document.getElementById('posts-scroll-sentinel');
      if (sentinel) observer.observe(sentinel);

      return () => observer.disconnect();
    }, [hasMore, loadingMore, posts]);

  // 4. THE LIKE FUNCTION - Hybrid UI (Optimistic Visuals + Pessimistic Math)
  const handleLike = async (id: number) => {
    const token = localStorage.getItem('glide_token');
    if (!token) {
      alert("Please log in to like posts!");
      return;
    }

    // Step 1: Check current visual state
    const targetPost = posts.find(p => p.id === id);
    if (!targetPost) return;
    const isLiking = !targetPost.userLiked;

    // Step 2: OPTIMISTIC VISUALS ONLY (Instantly toggle the red heart)
    setPosts(currentPosts => currentPosts.map(post =>
      post.id === id ? { ...post, userLiked: isLiking } : post
    ));

    // POST request to the backend to update the like in the database
    try {
      const res = await fetch(`http://localhost:3000/api/posts/${id}/like`, {
        method: 'POST', 
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        }
      });

      // If the token is invalid/expired, we alert the user, clear their session, and rollback the visual toggle.
      if (res.status === 401 || res.status === 403) {
        alert("Your session expired. Please log in again.");
        localStorage.removeItem('glide_token');
        localStorage.removeItem('glide_user');
        
        // Rollback the visual if token fails
        setPosts(currentPosts => currentPosts.map(post =>
          post.id === id ? { ...post, userLiked: !isLiking } : post
        ));
        return;
      }

      // If the response is OK, we parse the new like status from the backend and update the likes count accordingly.
      if (res.ok) {
        const data = await res.json(); 
        
        // Step 3: PESSIMISTIC MATH (Update the number ONLY after server confirms)
        setPosts(currentPosts => currentPosts.map(post => {
          if (post.id === id) {
            return { 
              ...post, 
              // Math uses the backend's strict toggle response
              likes: data.liked ? (post.likes || 0) + 1 : Math.max(0, (post.likes || 0) - 1) 
            };
          }
          return post;
        }));
      }
    } catch (error) {
      console.error("Failed to update like in database:", error);
      // Rollback the visual if the user's WiFi drops mid-click
      setPosts(currentPosts => currentPosts.map(post =>
        post.id === id ? { ...post, userLiked: !isLiking } : post
      ));
    }
  };

  // 5. The Save Function (Optimistic UI for Bookmarks)
  const handleSave = async (id: number) => {
    // Similar structure to the Like function, but simpler since we don't have a count to update.
    // We check for the token, toggle the bookmark icon immediately, and then confirm with the backend.
    const token = localStorage.getItem('glide_token');
    if (!token) {
      alert("Please log in to save posts!");
      return;
    }

    // Step 1: Check current visual state
    const targetPost = posts.find(p => p.id === id);
    if (!targetPost) return;

    // We determine whether the user is currently saving or unsaving the post based on the existing 'userSaved' state.
    // If 'userSaved' is false, then the user is trying to save it (isSaving = true). If 'userSaved' is true, then the 
    // user is trying to unsave it (isSaving = false).
    const isSaving = !targetPost.userSaved;

    // OPTIMISTIC VISUALS ONLY (Instantly toggle the bookmark icon color)
    // We update the 'userSaved' property of the target post immediately to reflect the user's action, giving instant feedback.
    setPosts(currentPosts => currentPosts.map(post =>
      post.id === id ? { ...post, userSaved: isSaving } : post
    ));

    // POST request to the backend to update the save status in the database
    try {
      const res = await fetch(`http://localhost:3000/api/posts/${id}/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      // If the token is invalid/expired, we alert the user, clear their session, and rollback the visual toggle.
      if (res.status === 401 || res.status === 403) {
        alert("Your session expired. Please log in again.");
        localStorage.removeItem('glide_token');
        localStorage.removeItem('glide_user');
        
        // Rollback the visual if token fails
        setPosts(currentPosts => currentPosts.map(post =>
          post.id === id ? { ...post, userSaved: !isSaving } : post
        ));
        return;
      }
    } catch (error) {
      console.error("Failed to update save in database:", error);
      // Rollback the visual if the user's WiFi drops mid-click
      setPosts(currentPosts => currentPosts.map(post =>
        post.id === id ? { ...post, userSaved: !isSaving } : post
      ));
    }
  };

  // 6. THE SHARE FUNCTION
  const handleShare = async (id: number, url: string, headline: string) => {
    if (navigator.share) {
      // Native Mobile Share
      try {
        await navigator.share({
          title: 'Glide',
          text: `Check out this news: ${headline}`,
          url: url,
        });
      } catch (err) {
        console.error("Error sharing natively:", err);
      }
    } else {
      // Desktop Fallback: Copy to Clipboard
      try {
        await navigator.clipboard.writeText(url);
        setCopiedId(id); // Trigger the "Copied!" tooltip
        setTimeout(() => setCopiedId(null), 2000); // Hide tooltip after 2 seconds
      } catch (err) {
        console.error("Failed to copy to clipboard:", err);
      }
    }
  };

  // 7. DYNAMIC CATEGORY EXTRACTION
  // - We extract all categories from the posts array.
  // - We use 'new Set()' to remove duplicates (so if there are 5 Football posts, 'Football' only appears once).
  // - We prepend 'All' to the front of the array. 
  const uniqueCategories = ['All', ...Array.from(new Set(posts.map(post => post.sport_category)))];

  // Filter Logic - before we render, we filter the master 'posts' array. 
  // If 'All' is selected, show everything. Otherwise, only show posts that match the active category.
  const filteredPosts = activeCategory === 'All' 
    ? posts 
    : posts.filter(post => post.sport_category === activeCategory);

  return (
    // Adjusted background/text colors for Light/Dark mode with a smooth transition
    // Adjusted max-w constraints on wrapper wrapper block to hold large layouts comfortably
    <main className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 relative transition-colors duration-300">
      
      {/* Changed max-w-6xl to max-w-3xl to perfectly center the single-column feed */}
      <div className="max-w-3xl mx-auto">
        
        {/* Header Section */}
        <div className="flex items-center justify-between mb-4"> 
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            Glide
          </h1>
          
          {/* Placed the ThemeToggle next to the AuthButton */}
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            {/* Replaced the old manual login button with your new component */}
            <AuthButton />
          </div>
        </div>

        {/* Navigation Section */}
        <div className="flex justify-center space-x-8 mb-8">
          <span className="text-gray-900 dark:text-white font-bold text-lg border-b-2 border-purple-500 pb-1 cursor-default">
            Posts
          </span>
          <Link href="/reels" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
            Reels
          </Link>
          {/* Added the brand new routing link for the dedicated Match Center page */}
          <Link href="/match_center" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
            Match Center
          </Link>
        </div>

        {/* HIGHLIGHT: Removed the grid-cols layout entirely. The feed now beautifully centers itself. */}
        <div className="w-full">
          
          {/* 8. CONDITIONAL RENDERING */}
          {loading && page === 1 ? (
            // Show this while waiting for the Express server to reply
            <p className="text-center text-gray-500 dark:text-gray-400 animate-pulse mt-20">Loading the latest news...</p>
          ) : posts.length === 0 ? (
            // Show this if the database is empty
            <p className="text-center text-gray-500 dark:text-gray-400 mt-20">No news in the database yet. Run the scraper!</p>
          ) : (
            <>
              {/* The Category Filter Bar UI */}
              <div className="flex space-x-3 overflow-x-auto pb-4 mb-6 scrollbar-hide">
                {uniqueCategories.map(category => (
                  <button
                    key={category}
                    onClick={() => setActiveCategory(category)}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-200 ${
                      activeCategory === category
                        ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30 border border-purple-500'
                        : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-800'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>

              {/* 9. MAPPING THE DATA */}
              {/* We now loop through 'filteredPosts' instead of 'posts' */}
              <div className="space-y-6">
                {filteredPosts.map((post: any) => (
                  <div key={post.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-md dark:shadow-lg hover:border-gray-300 dark:hover:border-gray-700 transition-colors group overflow-hidden">
                    
                    {/* Top Row: Category Badge and Timestamp */}
                    <div className="flex justify-between items-center mb-4">
                      <span className="bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold px-2.5 py-0.5 rounded uppercase tracking-wider">
                        {post.sport_category}
                      </span>
                      <span className="text-gray-400 dark:text-gray-500 text-xs">
                        {new Date(post.timestamp).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Image Rendering Phase - The actual image container! */}
                    {/* We use standard img tag, set a fixed height for consistency, and add a hover scale effect */}
                    {post.image_url && (
                      <div className="w-full h-48 md:h-64 rounded-xl overflow-hidden mb-5 bg-gray-200 dark:bg-gray-800 relative">
                        <img 
                          src={post.image_url} 
                          alt={post.headline}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-in-out"
                          loading="lazy"
                        />
                      </div>
                    )}

                    {/* Main Content: AI Generated Headline & Summary */}
                    <h2 className="text-xl font-bold mb-3">{post.headline}</h2>
                    <p className="text-gray-600 dark:text-gray-300 text-sm mb-4 leading-relaxed">{post.content}</p>

                    {/* Bottom Row now includes the interactive Like button */}
                    <div className="flex justify-between items-center border-t border-gray-100 dark:border-gray-800 pt-4 mt-4">
                      
                      {/* Left Side: Excitement Meter */}
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Excitement:</span>
                        <div className="flex">
                          {/* We dynamically generate a visual meter based on the 1-10 excitement_level */}
                          {[...Array(10)].map((_, i) => (
                            <div 
                              key={i} 
                              className={`h-1.5 w-3 mx-px rounded-full ${i < post.excitement_level ? 'bg-gradient-to-r from-orange-500 to-red-500' : 'bg-gray-200 dark:bg-gray-800'}`}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Right Side: Like Button, Save Button, Share Button, and Read Source Link */}
                      <div className="flex items-center space-x-6">
                        
                        {/* The Like Button */}
                        <button 
                          onClick={() => handleLike(post.id)}
                          // Force the button to be red if the user liked it
                          className={`flex items-center space-x-1.5 transition-colors group ${post.userLiked ? 'text-red-500' : 'text-gray-400 hover:text-red-500'}`}
                        >
                          {/* SVG Heart Icon */}
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            className="h-5 w-5 group-active:scale-110 transition-transform" 
                            // Fills the inside of the heart with color if liked
                            fill={post.userLiked ? "currentColor" : "none"} 
                            viewBox="0 0 24 24" 
                            stroke="currentColor" 
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                          </svg>
                          {/* Fallback to 0 if post.likes is undefined/null */}
                          <span className="text-sm font-semibold">{post.likes || 0}</span>
                        </button>

                        {/* The Bookmark Button */}
                        <button 
                          onClick={() => handleSave(post.id)}
                          className={`flex items-center space-x-1.5 transition-colors group ${post.userSaved ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500'}`}
                          title="Save this post"
                        >
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            className="h-5 w-5 group-active:scale-110 transition-transform" 
                            fill={post.userSaved ? "currentColor" : "none"} 
                            viewBox="0 0 24 24" 
                            stroke="currentColor" 
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                          </svg>
                        </button>

                        {/* The Share Button */}
                        <button 
                          onClick={() => handleShare(post.id, post.url, post.headline)}
                          className="flex items-center space-x-1 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors group relative"
                          title="Share this post"
                        >
                          {/* SVG Share Icon */}
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-active:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                          
                          {/* Dynamic Tooltip: Only shows if this specific post was copied */}
                          {copiedId === post.id && (
                            <span className="absolute -top-10 -left-4 bg-gray-800 dark:bg-gray-700 text-white text-xs font-semibold px-2.5 py-1 rounded-md shadow-lg whitespace-nowrap animate-pulse">
                              Copied!
                            </span>
                          )}
                        </button>

                        <a 
                          href={post.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300 font-medium"
                        >
                          Read Source &rarr;
                        </a>
                      </div>
                    </div>

                  </div>
                ))}
              </div>

              {/* Infinite Scroll Sentinel replacing the Load More button */}
              {hasMore && (
                <div id="posts-scroll-sentinel" className="mt-10 flex justify-center h-16 items-center">
                  {loadingMore && (
                    <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                  )}
                </div>
              )}
              
              {!hasMore && posts.length > 0 && (
                <p className="text-center text-gray-500 mt-10 mb-10 text-sm font-medium">You have reached the end of the feed.</p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}