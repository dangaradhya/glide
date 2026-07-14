// app/page.tsx

// 1. DIRECTIVE
// Next.js defaults to Server Components. We use "use client" to tell Next.js 
// that this is a dynamic component that needs to run in the user's browser,
// allowing us to use React hooks like useState and useEffect.
"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
// Imported useRouter to safely navigate inside the mobile app wrapper
import { useRouter } from 'next/navigation';

// Import your Google Auth and Theme Toggle component for use in the header
import AuthButton from '@/components/AuthButton';
import ThemeToggle from '@/components/ThemeToggle';
// Capacitor Share API for native sharing functionality on mobile devices
import { Share } from '@capacitor/share';
// Pull-to-Refresh gesture hook + its shared visual indicator
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/PullToRefreshIndicator';
// Shared API client - base URL + auto-attached auth header, see lib/api.ts
import { apiFetch, API_BASE_URL } from '@/lib/api';
import BottomNav from '@/components/BottomNav';

// A simple one-time lock for the initial page load. 
// It resets perfectly on a hard refresh, keeping your desired behavior intact!
let initialPostSeekExecuted = false;

export default function Home() {
  // Initialize the Next.js router
  const router = useRouter();

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

  // States for the Comment Drawer
  const [isCommentDrawerOpen, setIsCommentDrawerOpen] = useState(false);
  const [activePost, setActivePost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newCommentText, setNewCommentText] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // States for Editing/Deleting
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editCommentText, setEditCommentText] = useState("");

  // States for Global FTS5 Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // State for the Auto-Paginate & Seek Engine
  const [autoScrollTarget, setAutoScrollTarget] = useState<number | null>(null);

  // Check login status and decode user ID for conditional rendering of input fields and edit/delete buttons
  useEffect(() => {
    const token = localStorage.getItem('glide_token');
    if (token) {
      setIsAuthenticated(true);
      try {
        // Securely decode the JWT payload to get the user's ID
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUserId(payload.userId);
      } catch (e) {
        console.error("Failed to parse token payload");
      }
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  // Debounced Search Effect (Prevents database overload by waiting 300ms after typing stops)
  useEffect(() => {
    // If the search query is empty or just spaces, we clear results and hide the dropdown immediately.
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    // We set a debounce timer that waits 300ms after the user stops typing before making the search request.
    const debounceTimer = setTimeout(async () => {
      setIsSearching(true);
      try {
        // Deliberately plain fetch, not apiFetch: this route never sends an auth header
        // today (even when logged in), and search doesn't need one anyway
        const res = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
          setShowSearchDropdown(true);
        }
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  // The Auto-Paginate & Seek Engine
  // This effect runs every time the 'posts' array updates. If the user searched for a post 
  // that isn't loaded yet, this engine automatically rapidly fetches subsequent pages until 
  // the post naturally appears in its correct chronological position in the DOM.
  useEffect(() => {
    if (autoScrollTarget === null) return;

    // We try to find the target element in the DOM using its unique ID. If it's found, we scroll to it and flash a highlight.
    const element = document.getElementById(`post-${autoScrollTarget}`);
    
    if (element) {
      // Target acquired! Scroll down to it, flash the highlight, and disengage the engine.
      setTimeout(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ring-4', 'ring-purple-500', 'transition-all', 'duration-500');
        setTimeout(() => element.classList.remove('ring-4', 'ring-purple-500'), 2000);
      }, 100);
      setAutoScrollTarget(null);
    } else if (hasMore && !loadingMore && !loading) {
      // Target is not in the DOM yet. Force the pagination to fetch the next page immediately.
      setLoadingMore(true);
      setPage(prev => prev + 1);
    } else if (!hasMore) {
      // Safety catch: We hit the end of the database and the post wasn't found
      alert("Could not locate this post in the feed.");
      setAutoScrollTarget(null);
      setLoadingMore(false);
    }
  }, [posts, autoScrollTarget, hasMore, loadingMore, loading]);

  // Deep Link Navigation Watcher for Posts (Runs once on app boot)
  // If a user clicks a shared link (e.g., https://glidesports.app/#post-133), 
  // this grabs the '133' and fires up your Auto-Seek engine automatically!
  useEffect(() => {
    // If we already scrolled to a post this session, ignore ghost re-renders from tab switches
    if (initialPostSeekExecuted) return;
    
    const hash = window.location.hash;

    // We check if the URL has a hash that starts with '#post-'. If it does, we extract 
    // the post ID from the hash and set it as the target for our Auto-Seek engine.
    if (hash && hash.startsWith('#post-')) {
      const targetId = parseInt(hash.replace('#post-', ''), 10);
      if (!isNaN(targetId)) {
        // Engage the lock and set the target for the Auto-Seek engine. This will trigger the effect above to 
        // start fetching pages until the post is found.
        initialPostSeekExecuted = true;
        setAutoScrollTarget(targetId);
        // Clean up the URL so it doesn't re-trigger if the user manually refreshes the page
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  // 3. THE NETWORK REQUEST 
  // Refactored Fetch Logic to accept a page number
  const fetchPosts = async (pageNum: number) => {
    try {
      // Artificial half-second delay for infinite scroll feel
      if (pageNum > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const res = await apiFetch(`/api/posts?page=${pageNum}&limit=5`);
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

  // Set right before a refresh-triggered setPage(1) below, so the pagination effect below
  // can tell "page reset by a refresh that already fetched page 1" apart from a normal
  // page change, and skip firing a redundant duplicate fetch for the page it just skipped to.
  const skipNextPageFetchRef = useRef(false);

  // Replaced the interval with a page dependency
  // This runs automatically on initial load (page=1), and whenever the 'page' state changes.
  useEffect(() => {
    if (skipNextPageFetchRef.current) {
      skipNextPageFetchRef.current = false;
      return;
    }
    fetchPosts(page);
  }, [page]);

  // Pull-to-Refresh Handler
  // Unlike fetchPosts (which APPENDS the next page), this REPLACES the entire feed with
  // a fresh "page 1" fetch, ordered by timestamp DESC. Since new posts really do land
  // roughly hourly from the scraper, this is a genuine refresh (not just a visual trick)
  // for the Posts feed - it will surface whatever the newest 5 posts actually are right now.
  const refreshFeed = async () => {
    if (loadingMore) return; // Don't clobber an in-flight "load more" pagination request
    try {
      const res = await apiFetch(`/api/posts?page=1&limit=5`);
      const data = await res.json();

      setPosts(data);
      // If the user had paginated past page 1 before pulling to refresh, setPage(1) below
      // would otherwise re-fire the effect above and fetch page 1 a second time - we just did.
      if (page !== 1) skipNextPageFetchRef.current = true;
      setPage(1);
      setHasMore(data.length > 0);
    } catch (err) {
      console.error("Error refreshing feed:", err);
    }
  };

  const { pullDistance, isRefreshing: isPullRefreshing, threshold: pullThreshold } = usePullToRefresh(refreshFeed, { windowScroll: true });

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
      const res = await apiFetch(`/api/posts/${id}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
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
      const res = await apiFetch(`/api/posts/${id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
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
  // Ensure the signature is EXACTLY (id, headline) - DO NOT pass url here!
  const handleShare = async (id: number, headline: string) => {
    // Generate the deep link to this exact post on your live Vercel domain
    const deepLink = `https://glidesports.app/#post-${id}`;

    try {
      // Trigger the native Android share sheet
      await Share.share({
        title: 'Glide',
        text: `Check out this news: ${headline}`,
        url: deepLink,
        dialogTitle: 'Share with buddies',
      });
    } catch (err: any) {
      console.error("Error sharing natively:", err);
      
      // Desktop Fallback: Copy to Clipboard
      try {
        await navigator.clipboard.writeText(deepLink);
        setCopiedId(id); // Trigger the "Copied!" tooltip
        setTimeout(() => setCopiedId(null), 2000); 
      } catch (copyErr) {
        console.error("Failed to copy to clipboard:", copyErr);
      }
    }
  };

  // The Logic for fetching and submitting comments from the drawer
  const openCommentDrawer = async (post: any) => {
    // When a user clicks the comment button, we set the active post, open the drawer, and fetch the comments for that specific post.
    setActivePost(post);
    setIsCommentDrawerOpen(true);
    setCommentsLoading(true);

    // We make a GET request to fetch comments for the specific post ID. The backend should return an array of comments related to that post.
    try {
      // Deliberately plain fetch, not apiFetch: this route never sends an auth header today
      const res = await fetch(`${API_BASE_URL}/api/posts/${post.id}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch (err) {
      console.error("Error fetching comments:", err);
    } finally {
      setCommentsLoading(false);
    }
  };

  // The function to submit a new comment from the drawer input
  const submitComment = async (e: React.FormEvent<HTMLFormElement>) => {
    // We prevent the default form submission behavior, check if the comment text is not empty and if there's an active post to comment on.
    e.preventDefault();
    if (!newCommentText.trim() || !activePost) return;

    const token = localStorage.getItem('glide_token');
    if (!token) return alert("Please log in to comment.");

    // We make a POST request to submit the new comment to the backend. The body of the request includes the comment text, and we attach the token for authentication.
    try {
      const res = await apiFetch(`/api/posts/${activePost.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newCommentText })
      });

      if (res.ok) {
        const newCommentObj = await res.json();
        // Instantly push the new comment to the drawer UI
        setComments(prev => [...prev, newCommentObj]);
        setNewCommentText("");
        
        // Optimistically increment the comment counter on the main feed
        setPosts(currentPosts => currentPosts.map(p => 
          p.id === activePost.id ? { ...p, commentCount: (p.commentCount || 0) + 1 } : p
        ));
      } else {
        alert("Failed to post comment.");
      }
    } catch (err) {
      console.error("Error submitting comment:", err);
    }
  };

  // Handlers for Editing and Deleting Comments
  const handleEditSubmit = async (commentId: number) => {
    if (!editCommentText.trim()) return;

    // PUT request to update the comment text in the database. We also optimistically update the UI to reflect the new comment text immediately.
    try {
      const res = await apiFetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editCommentText })
      });

      if (res.ok) {
        // Update the UI instantly without reloading
        setComments(prev => prev.map(c => c.id === commentId ? { ...c, text: editCommentText } : c));
        setEditingCommentId(null);
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Failed to update comment.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!confirm("Are you sure you want to delete this take?")) return;

    // DELETE request to remove the comment from the database. We also optimistically remove the comment from the UI and
    // decrement the comment counter on the main feed.
    try {
      const res = await apiFetch(`/api/comments/${commentId}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        // Remove from UI and decrement the counter
        setComments(prev => prev.filter(c => c.id !== commentId));
        setPosts(currentPosts => currentPosts.map(p => 
          p.id === activePost.id ? { ...p, commentCount: Math.max(0, (p.commentCount || 1) - 1) } : p
        ));
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Failed to delete comment.");
      }
    } catch (err) {
      console.error(err);
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
    // No extra top padding needed here for the notch - <body>'s pt-[var(--app-banner-height)]
    // (see layout.tsx) already reserves that space for every page. Adding it again here
    // would double-count the notch inset on top of what body already reserves.
    <main className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 relative overflow-hidden">

      {/* Pull-to-Refresh Indicator - tracks the drag gesture detected on the window */}
      <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isPullRefreshing} threshold={pullThreshold} />

      {/* Changed max-w-6xl to max-w-3xl to perfectly center the single-column feed */}
      {/* Bottom padding clears the mobile bottom nav so the last card isn't hidden behind it.
          Grows by the safe-area inset (same var used on the nav bar below) since the nav's
          real on-screen height grows by that amount on notched/gesture-bar devices */}
      <div className="max-w-3xl mx-auto relative z-10 pb-[calc(5rem_+_var(--app-safe-bottom))] md:pb-0">
        
      {/* Responsive Header Container */}
        {/* We use flex-col on the main wrapper, splitting the header into 2 distinct rows so nothing crashes on mobile */}
        {/* Changed mb-8 to mb-3 md:mb-8 to dramatically tighten the gap below the header on mobile */}
        <div className="w-full z-50 mb-3 md:mb-8 flex flex-col transition-all relative"> 
          
          {/* Row 1: Logo, Search, and Auth - Spreads out on desktop, tight on mobile */}
          {/* Changed mb-4 to mb-2 and gap-y-4 to gap-y-3 to pull the search bar closer to the top elements */}
          <div className="flex flex-wrap justify-between items-center w-full mb-2 md:mb-6 gap-y-3">
            
            <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent shrink-0 order-1">
              Glide
            </h1>
            
            {/* The Global Search Bar Component */}
            <div className="w-full md:w-auto md:flex-1 md:max-w-sm mx-0 md:mx-4 relative order-3 md:order-2 z-40">
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Search news & reels..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => searchQuery.trim() && setShowSearchDropdown(true)}
                  // Timeout allows the user to click a dropdown link before it disappears
                  onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)} 
                  className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full px-4 py-2 pl-10 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-sm transition-shadow text-sm"
                />
                <svg className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {isSearching && (
                  <div className="absolute right-3 top-2.5 w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                )}
              </div>

              {/* Search Results Dropdown Panel */}
              {showSearchDropdown && searchResults.length > 0 && (
                <div className="absolute top-full mt-2 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl overflow-hidden max-h-96 overflow-y-auto z-50">
                  {searchResults.map((result: any, idx: number) => {
                    const isPost = result.doc_type === 'POST';

                    // Swapped the raw <a> tag for a <button> that triggers Next.js router.push(). 
                    // This physically stops Capacitor from treating the click as a hard app reload, 
                    // allowing seamless navigation to the Reels tab!
                    return (
                      <button 
                        key={idx} 
                        onClick={(e) => {
                          e.preventDefault(); 
                          setShowSearchDropdown(false);
                          
                          if (isPost) {
                            // Reset the category filter to ensure the post isn't hidden by "Basketball" or "F1" filters
                            setActiveCategory('All');
                            
                            const element = document.getElementById(`post-${result.doc_id}`);
                            if (element) {
                              // It's already loaded, scroll normally
                              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              element.classList.add('ring-4', 'ring-purple-500', 'transition-all', 'duration-500');
                              setTimeout(() => element.classList.remove('ring-4', 'ring-purple-500'), 2000);
                            } else {
                              // The post isn't loaded yet. Engage the Auto-Seek engine!
                              setAutoScrollTarget(result.doc_id);
                            }
                          } else {
                            // Next.js internal router bypasses the Capacitor bug!
                            router.push(`/reels?reelId=${result.video_id}`);
                          }
                        }}
                        className="flex flex-col w-full text-left p-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${isPost ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {result.doc_type}
                          </span>
                        </div>
                        <span className="text-sm font-bold text-gray-900 dark:text-white line-clamp-1">{result.title}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">{result.content}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              
              {showSearchDropdown && searchResults.length === 0 && searchQuery.trim() && !isSearching && (
                <div className="absolute top-full mt-2 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-4 text-center text-sm text-gray-500 z-50">
                  No results found.
                </div>
              )}
            </div>

            {/* Using gap-2 md:gap-4 for smooth responsive spacing between buttons */}
            {/* Added order-2 on mobile so the Auth buttons stay top-right, next to the logo. */}
            <div className="flex items-center gap-2 md:gap-4 shrink-0 order-2 md:order-3">
              <ThemeToggle />
              <AuthButton />
            </div>
          </div>

          {/* Row 2: Navigation Section - Perfectly centered */}
          {/* Added hidden md:flex to hide this row entirely on mobile screens */}
          <div className="hidden md:flex justify-center gap-6 md:gap-8">
            <span className="text-gray-900 dark:text-white font-bold text-lg border-b-2 border-purple-500 pb-1 cursor-default">
              Posts
            </span>
            <Link href="/reels" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
              Reels
            </Link>
            <Link href="/match_center" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
              Match Center
            </Link>
          </div>
        </div>

        {/* Removed the grid-cols layout entirely. The feed now beautifully centers itself. */}
        <div className="w-full">
          
          {/* 8. CONDITIONAL RENDERING */}
          {loading && page === 1 ? (
            // Show this while waiting for the Express server to reply
            <p className="text-center text-gray-500 dark:text-gray-400 animate-pulse mt-20">Loading the latest news...</p>
          ) : posts.length === 0 ? (
            // Show this if the database is empty
            <p className="text-center text-gray-500 dark:text-gray-400 mt-20 px-4 leading-relaxed">
              No news available right now. Please check your internet connection and refresh the page!
            </p>
          ) : (
            <>
              {/* The Category Filter Bar UI */}
              {/* Changed pb-4 mb-6 to pb-2 mb-3 md:pb-4 md:mb-6. This pulls the first post card right up under the buttons! */}
              <div className="flex space-x-3 overflow-x-auto pb-2 mb-3 md:pb-4 md:mb-6 scrollbar-hide">
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
                  <div 
                    key={post.id} 
                    id={`post-${post.id}`} // Ensure the ID is attached to the card for the scroll engine to find
                    className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 md:p-6 shadow-md dark:shadow-lg hover:border-gray-300 dark:hover:border-gray-700 transition-colors group overflow-hidden"
                  >
                    
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

                    {/* Grouped all action icons on the left with uniform gaps, pushed Source to the right */}
                    <div className="flex justify-between items-center w-full border-t border-gray-100 dark:border-gray-800 pt-4 mt-4 px-1 sm:px-2">
                        
                        {/* Left Group: Primary Actions */}
                        <div className="flex items-center gap-4 md:gap-6">
                          {/* The Like Button */}
                          <button 
                            onClick={() => handleLike(post.id)}
                            className={`flex items-center gap-1.5 transition-colors group ${post.userLiked ? 'text-red-500' : 'text-gray-400 hover:text-red-500'}`}
                          >
                            <svg 
                              xmlns="http://www.w3.org/2000/svg" 
                              className="h-5 w-5 group-active:scale-110 transition-transform" 
                              fill={post.userLiked ? "currentColor" : "none"} 
                              viewBox="0 0 24 24" 
                              stroke="currentColor" 
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            </svg>
                            <span className="text-sm font-semibold">{post.likes || 0}</span>
                          </button>

                          {/* The Comment Button */}
                          <button 
                            onClick={() => openCommentDrawer(post)}
                            className="flex items-center gap-1.5 text-gray-400 hover:text-purple-500 transition-colors group"
                            title="View Discussion"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-active:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            <span className="text-sm font-semibold">{post.commentCount || 0}</span>
                          </button>

                          {/* The Bookmark Button */}
                          <button 
                            onClick={() => handleSave(post.id)}
                            className={`flex items-center gap-1.5 transition-colors group ${post.userSaved ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500'}`}
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
                            onClick={() => handleShare(post.id, post.headline)}
                            className="flex items-center gap-1 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors group relative"
                            title="Share this post"
                          >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-active:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                            </svg>
                            
                            {copiedId === post.id && (
                              <span className="absolute -top-10 -left-4 bg-gray-800 dark:bg-gray-700 text-white text-xs font-semibold px-2.5 py-1 rounded-md shadow-lg whitespace-nowrap animate-bounce">
                                Copied!
                              </span>
                            )}
                          </button>
                        </div>

                        {/* Right Group: Read Source Link pushed strictly to the right edge */}
                        <div>
                          <a 
                            href={post.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300 font-bold"
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

      {/* Auto-Seek UI Overlay */}
      {/* This renders dynamically if the Seek Engine is hunting for a post down the feed */}
      {autoScrollTarget !== null && (
        <div className="fixed bottom-10 left-1/2 transform -translate-x-1/2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-6 py-3 rounded-full shadow-2xl z-50 flex items-center space-x-3 animate-bounce">
          <div className="w-4 h-4 border-2 border-white dark:border-gray-900 border-t-transparent rounded-full animate-spin"></div>
          <span className="font-bold text-sm">Hunting for post in the archives...</span>
        </div>
      )}

      {/* The Sliding Comment Drawer */}
      {/* Background Overlay */}
      {isCommentDrawerOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-70 transition-opacity" 
          onClick={() => setIsCommentDrawerOpen(false)}
        />
      )}

      {/* The Drawer Panel */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[400px] bg-white dark:bg-gray-900 shadow-2xl z-70 transform transition-transform duration-300 ease-in-out flex flex-col border-l border-gray-200 dark:border-gray-800 ${
          isCommentDrawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-950/50">
          <h2 className="text-lg font-bold">Comments</h2>
          <button 
            onClick={() => setIsCommentDrawerOpen(false)} 
            className="p-2 bg-gray-200 dark:bg-gray-800 rounded-full hover:bg-gray-300 dark:hover:bg-gray-700 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Post Context Banner */}
        {activePost && (
          <div className="p-4 bg-purple-50 dark:bg-purple-900/10 border-b border-gray-200 dark:border-gray-800">
            <p className="text-xs text-purple-600 dark:text-purple-400 font-bold uppercase mb-1">Discussing</p>
            <p className="text-sm font-semibold line-clamp-2">{activePost.headline}</p>
          </div>
        )}

        {/* Comment Thread Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {commentsLoading ? (
            <div className="flex justify-center mt-10">
              <div className="w-6 h-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-10">
              <p>No takes on this yet.</p>
              <p className="text-sm mt-1">Be the first to drop a comment!</p>
            </div>
          ) : (
            comments.map(comment => {
              // Check if this comment belongs to the logged-in user
              const isOwner = comment.user_id === currentUserId;
              
              // Calculate if it was posted less than 15 minutes ago (remembering DB is UTC)
              const commentTime = new Date(comment.timestamp + 'Z').getTime();
              const timeElapsedMinutes = (Date.now() - commentTime) / (1000 * 60);
              const isWithinEditWindow = timeElapsedMinutes <= 15;
              
              // We use the backend data directly, no local storage checks! 
              return (
                <div key={comment.id} className="flex space-x-3 group">
                  <img 
                    src={comment.picture || 'https://via.placeholder.com/40'} 
                    alt={comment.name} 
                    className="w-8 h-8 rounded-full shadow-sm mt-1 object-cover" 
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm">{comment.name}</span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(comment.timestamp + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    
                    {editingCommentId === comment.id ? (
                      <div className="mt-2 flex flex-col space-y-2">
                        <input 
                          type="text" 
                          value={editCommentText}
                          onChange={(e) => setEditCommentText(e.target.value)}
                          className="bg-gray-100 dark:bg-gray-800 border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none w-full"
                          autoFocus
                        />
                        <div className="flex space-x-2">
                          <button onClick={() => handleEditSubmit(comment.id)} className="text-xs bg-purple-600 text-white px-3 py-1 rounded">Save</button>
                          <button onClick={() => setEditingCommentId(null)} className="text-xs bg-gray-300 dark:bg-gray-700 px-3 py-1 rounded text-gray-800 dark:text-gray-200">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start">
                        <p className="text-sm mt-1 text-gray-800 dark:text-gray-200 break-words bg-gray-100 dark:bg-gray-800 p-3 rounded-xl rounded-tl-none inline-block">
                          {comment.text}
                        </p>
                        
                        {/* Action buttons (Only show if owner AND within 15 minutes) */}
                        {isOwner && isWithinEditWindow && (
                          <div className="flex space-x-3 mt-1 opacity-100 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => { setEditingCommentId(comment.id); setEditCommentText(comment.text); }}
                              className="text-[11px] font-semibold text-gray-500 hover:text-purple-500 active:text-purple-600 p-1 -ml-1"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => handleDeleteComment(comment.id)}
                              className="text-[11px] font-semibold text-gray-500 hover:text-red-500 active:text-red-600 p-1"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Comment Input Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          {!isAuthenticated ? (
            <div className="text-center p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Sign in to join the conversation.</p>
            </div>
          ) : (
            <form onSubmit={submitComment} className="flex items-center space-x-2">
              <input 
                type="text" 
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder="Drop a take..."
                className="flex-1 bg-gray-100 dark:bg-gray-800 border-none rounded-full px-4 py-2.5 focus:ring-2 focus:ring-purple-500 outline-none text-sm"
              />
              <button 
                type="submit" 
                disabled={!newCommentText.trim()}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-full p-2.5 transition-colors shadow-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transform rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>
          )}
        </div>
      </div>
      
      {/* Mobile Bottom Navigation Bar (Hidden on Desktop) */}
      <BottomNav active="posts" />

    </main>
  );
}