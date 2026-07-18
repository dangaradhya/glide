// app/reels/page.tsx

// This is the main page for the Reels section of the dashboard. 
// It fetches and displays YouTube Shorts in a vertical scrollable format with 
// snap scrolling. The page includes a top navigation bar to switch between Posts 
// and Reels, and it handles loading states and fetching more randomized reels.
"use client";

// 1. IMPORTS
// Importing Capacitor for native mobile features, React hooks for state and lifecycle management,
import { Capacitor } from '@capacitor/core';
import { useEffect, useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation'; 

// Added the Web Share API with a fallback to clipboard copying for maximum shareability across platforms
import { Share } from '@capacitor/share';
// Pull-to-Refresh gesture hook + its shared visual indicator
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/PullToRefreshIndicator';
// Shared API client - base URL + auto-attached auth header, see lib/api.ts
import { apiFetch, API_BASE_URL } from '@/lib/api';
import BottomNav from '@/components/BottomNav';
import TopTabs from '@/components/TopTabs';

function ReelsContent() {
  // 2. STATE MANAGEMENT
  // We maintain state for the list of reels, loading status, 
  // whether there are more reels to load, and whether we are currently loading more reels.
  const [reels, setReels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // We use state instead of a ref here because changing this value needs 
  // to trigger a React re-render to visually display the promo card.
  const [isMobileBrowser, setIsMobileBrowser] = useState(false);

  // To serve the correct App Store or Play Store link on the Promo Card
  const [isIOSBrowser, setIsIOSBrowser] = useState(false);

  // State to track the ID of the first newly loaded reel so we can auto-scroll to it
  const [pendingScrollId, setPendingScrollId] = useState<number | null>(null);

  // State to track which video is on screen and if it is paused
  const [activeReelId, setActiveReelId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  // Tracks the last video we restarted so we don't restart it again on unpause
  const lastPlayedIdRef = useRef<number | null>(null);

  // Added isGlobalMuted to handle strict desktop browser autoplay policies.
  // The first video will start muted until the user's first physical interaction (click/tap)
  const [isGlobalMuted, setIsGlobalMuted] = useState<boolean>(true);
  
  // State for the "Copied!" tooltip when sharing
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // States for the sliding Comment Drawer (Identical to the Posts feed logic)
  const [isCommentDrawerOpen, setIsCommentDrawerOpen] = useState(false);
  const [activeReel, setActiveReel] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newCommentText, setNewCommentText] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // States for Editing/Deleting comments
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editCommentText, setEditCommentText] = useState("");

  // Extract the reelId from the URL query parameters to allow deep linking to specific reels
  const searchParams = useSearchParams();
  const targetReelId = searchParams.get('reelId');

  useEffect(() => {
    const ua = navigator.userAgent; 
    const isMobileOS = /iPhone|iPad|iPod|Android/i.test(ua);
  
    // iPads on iOS 13+ deliberately report as Macintosh to get desktop sites.
    // The only reliable way to detect them is touch capability: a real Mac laptop
    // or desktop will always report maxTouchPoints as 0 or 1. An iPad always
    // reports 5 (five-finger multi-touch). This correctly separates Mac Chrome
    // on a MacBook (maxTouchPoints = 0) from iPad Safari (maxTouchPoints = 5)
    // and is not affected by the Capacitor native app at all.
    const isIPadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  
    const isCapacitorApp = Capacitor.isNativePlatform();
    
    if ((isMobileOS || isIPadOS) && !isCapacitorApp) {
      setIsMobileBrowser(true); 
  
      // isIOSBrowser now correctly includes: iPhone, old-style iPad UA,
      // AND modern iPad that masquerades as Mac. Android stays excluded.
      setIsIOSBrowser(/iPhone|iPad|iPod/i.test(ua) || isIPadOS);
    }
  }, []);

  // Decode JWT to track the logged-in user for comment ownership permissions
  // On component mount, we check localStorage for the presence of a JWT token to determine if the user is authenticated.
  useEffect(() => {
    const token = localStorage.getItem('glide_token');
    if (token) {
      setIsAuthenticated(true);
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUserId(payload.userId);
      } catch (e) {
        console.error("Failed to parse token payload");
      }
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  // 3. DATA FETCHING FUNCTION
  const fetchReels = async () => {
    try {
      // Artificial half-second delay for infinite scroll feel
      if (reels.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Generate a string of the video IDs currently sitting in React state, capped to the most
      // recent 100 so this doesn't grow unbounded over a long scroll session (see the exclude-list
      // NOT IN clause in server/index.js's GET /api/reels handler).
      const currentIds = reels.slice(-100).map(r => r.id).join(',');

      // Forward targetReelId directly into your server endpoint layout parameters
      const urlParam = targetReelId && reels.length === 0 ? `&reelId=${targetReelId}` : '';
      const res = await apiFetch(`/api/reels?limit=10&exclude=${currentIds}${urlParam}`);
      const data = await res.json();
      
      // If no more reels are returned, we set hasMore to false to stop further loading.
      if (data.length === 0) {
        setHasMore(false);
      } else {
        // We append new reels to the existing list, ensuring no duplicates.
        // We use a quick check to see if the new reel already exists in the current state before adding it.
        setReels(prevReels => {
          const newReels = [...prevReels];
          let firstNewAdded = false;

          data.forEach((newReel: any) => {
            if (!newReels.find(r => r.id === newReel.id)) {
              newReels.push(newReel);
              
              // If this is an infinite scroll load (not the initial load), 
              // capture the ID of the very first new reel we just fetched.
              if (!firstNewAdded && prevReels.length > 0) {
                 setPendingScrollId(newReel.id);
                 firstNewAdded = true;
              }
            }
          });
          return newReels;
        });

        // Instantly bind active state playback metrics directly onto your top item to solidify render priorities
        // If the user came from a deep link with a targetReelId, we want to set that as the active reel immediately to 
        // ensure it plays as soon as it loads.
        if (targetReelId && reels.length === 0 && data.length > 0) {
          setActiveReelId(data[0].id);
        }
      }
      setLoading(false);
      setLoadingMore(false);
    } catch (err) {
      console.error("Error fetching reels:", err);
      setLoading(false);
      setLoadingMore(false);
    }
  };
  
  // This runs on component mount, triggering a new fetch for reels.
  useEffect(() => {
    fetchReels();
    // We intentionally leave out dependencies here because we only want to fetch once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull-to-Refresh Handler
  // Reels are already served via `ORDER BY RANDOM()` on the backend, so there's no real
  // "newest reel" to chase the way there is for Posts. Instead, a refresh just grabs a
  // brand new random batch (no exclude list) and replaces the whole feed - which gives
  // the same "fresh content just loaded" feeling Instagram's pull-to-refresh gives you,
  // even though it's drawn from the same underlying pool of reels.
  const refreshReels = async () => {
    if (loadingMore) return; // Don't clobber an in-flight "load more" pagination request
    try {
      const res = await apiFetch(`/api/reels?limit=10`);
      const data = await res.json();

      setReels(data);
      setHasMore(data.length > 0);

      // Re-anchor playback state onto the new first reel so the observer/player sync cleanly
      lastPlayedIdRef.current = null;
      if (data.length > 0) {
        setActiveReelId(data[0].id);
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("Error refreshing reels:", err);
    }
  };

  const {
    pullDistance: reelsPullDistance,
    isRefreshing: isReelsRefreshing,
    threshold: reelsPullThreshold,
    containerRef: reelsContainerRef,
  } = usePullToRefresh(refreshReels);

  // Auto-Scroll Bridge Effect
  // When the new batch of reels hits the screen, this listener instantly smooth-scrolls 
  // the user directly into the first new video, bypassing the "scrolling wall" glitch entirely.
  useEffect(() => {
    if (pendingScrollId) {
      const el = document.querySelector(`[data-id="${pendingScrollId}"]`);
      if (el) {
        // Changed behavior to 'auto' for an instant snap, and dropped setTimeout to 10ms for immediate execution
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setPendingScrollId(null);
        }, 10);
      }
    }
  }, [reels, pendingScrollId]);

  // Deep Link Navigation Watcher
  // When a user lands from the profile vault page with a targetReelId parameter in the URL,
  // this effect runs as soon as our reels feed list hydrates, locate the matching item, 
  // and smoothly centers it on screen.
  useEffect(() => {
    if (targetReelId && reels.length > 0) {
      // We look for the DOM element that has a data-video-id attribute matching the targetReelId from the URL.
      // This allows us to directly target the specific reel that the user wants to view, even if it's not the first one in the list.
      // By using document.querySelector with a data attribute selector, we can find the exact element that represents the reel with the specified video ID.
      const element = document.querySelector(`[data-video-id="${targetReelId}"]`);

      // If we find the element, we call scrollIntoView with smooth behavior to center it on the screen. 
      // This allows users to share links that directly open specific reels in view.
      if (element) {
        // Wrapped inside an execution microtask macro block to guarantee DOM attachment layers are complete
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'auto', block: 'center' });

          // Clear the reelId parameter from the URL address bar immediately 
          // after the scroll snaps into place. This prevents subsequent infinite scrolls 
          // or manual browser refreshes from getting trapped on this single video.
          const url = new URL(window.location.href);
          url.searchParams.delete('reelId');
          window.history.replaceState({}, '', url.pathname);
        }, 80);
      }
    }
  }, [targetReelId, reels]);

  // The Intersection Observer (The Tracker)
  // This watches the screen. When a video container takes up at least 60% of the screen,
  // it sets that video's ID as the "active" reel.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // We loop through all observed entries (video containers) and check if they are intersecting with the viewport.
        entries.forEach((entry) => {
          // If the entry is intersecting (i.e., it's in view), we get its data-id attribute, which corresponds 
          // to the reel's ID, and set it as the active reel. We also set isPlaying to true to indicate 
          // that we want this video to play.
          if (entry.isIntersecting) {
            const id = Number(entry.target.getAttribute('data-id'));
            setActiveReelId(id);
            setIsPlaying(true); // Automatically try to play when it snaps into view
          }
        });
      },
      // Dropped to 0.5 to trigger playback slightly earlier during the swipe gesture.
      { threshold: 0.5 } 
    );

    // Attach the observer to every element with the 'reel-container' class
    // `data-id` is used to identify which reel is currently in view.
    // We use a class selector to find all reel containers and observe them with the Intersection Observer.
    // This allows us to track which video is currently in view and control playback accordingly.
    const elements = document.querySelectorAll('.reel-container');
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [reels]);

  // The YouTube API Controller
  // Whenever the active reel or the play state changes, we send a message to the iframes.
  useEffect(() => {
     // We loop through all the reels and get their corresponding iframes by ID. If the iframe 
    // exists and has a contentWindow, we check if this reel is the active one and if it should be playing. 
    // If it is the active reel and should be playing, we send a postMessage to the iframe to play the video. 
    // For all other reels (or if the user has manually paused), we send a postMessage to pause the video. 
    // This ensures that only the video currently in view plays, while all others are paused, creating a 
    // seamless viewing experience as the user scrolls through the reels.
    reels.forEach((reel) => {
      const iframe = document.getElementById(`reel-player-${reel.id}`) as HTMLIFrameElement;
      
      // If the iframe exists and has a contentWindow (i.e., it's loaded), we check if this reel is the active one and if it should be playing.
      if (iframe && iframe.contentWindow) {
        if (reel.id === activeReelId && isPlaying) {
          
          // Check if this is a NEW video snapping into view
          if (lastPlayedIdRef.current !== activeReelId) {
             // If it's new, reset it to the beginning by sending seekTo(0) to reset the video every time it comes into view.
             iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
             lastPlayedIdRef.current = activeReelId;
          }
          
          // Unmute ONLY if the user has globally satisfied the browser interaction policy
          if (!isGlobalMuted) {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute' }), '*');
          }
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), '*');
          
        } else {
          // Send PAUSE command to ALL OTHER videos, or if the user manually paused
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'mute' }), '*');
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo' }), '*');
        }
      }
    });
  // Added isGlobalMuted to the dependency array so it can trigger unmuting
  }, [activeReelId, isPlaying, isGlobalMuted, reels]);

  // The Infinite Scroll Observer
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    
    // We create a new Intersection Observer that watches a sentinel element at 
    // the bottom of the list. When this sentinel comes into view, it means the 
    // user has scrolled to the bottom, and we can load more reels.
    const scrollObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setLoadingMore(true);
          fetchReels();
        }
      },
      { threshold: 0.1 }
    );

    // We observe the sentinel element, which is a div at the bottom of the reels list. 
    // When this element comes into view, it triggers the observer callback to load more reels.
    const sentinel = document.getElementById('reels-scroll-sentinel');
    if (sentinel) scrollObserver.observe(sentinel);

    return () => scrollObserver.disconnect();
  // Include reels in dependency array so the observer always has the latest list of IDs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, reels]);

  // Hybrid UI Like Function
  const handleLike = async (id: number) => {
    // AUTH CHECK: Before allowing the user to like a reel, we check if they are authenticated by looking for a token in localStorage.
    const token = localStorage.getItem('glide_token');
    if (!token) {
      alert("Please log in to like reels!");
      return;
    }

    // OPTIMISTIC UI UPDATE: We immediately update the UI to reflect the like/unlike action for instant feedback.
    const targetReel = reels.find(r => r.id === id);
    if (!targetReel) return;
    const isLiking = !targetReel.userLiked;

    // OPTIMISTIC VISUALS ONLY
    setReels(currentReels => currentReels.map(reel =>
      reel.id === id ? { ...reel, userLiked: isLiking } : reel
    ));

    // BACKEND UPDATE: We then send a request to the backend to update the like status in the database.
    try {
      const res = await apiFetch(`/api/reels/${id}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      // ERROR HANDLING: If the response indicates that the user's session has expired (401 or 403), we alert the user, 
      // clear their session data, and rollback the optimistic UI update to reflect that the like action was not successful.
      if (res.status === 401 || res.status === 403) {
         alert("Your session expired. Please log in again.");
         localStorage.removeItem('glide_token');
         localStorage.removeItem('glide_user');
         
         // Rollback visuals
         setReels(currentReels => currentReels.map(reel =>
           reel.id === id ? { ...reel, userLiked: !isLiking } : reel
         ));
         return;
      }

      // If the response is successful, we parse the new like status from the backend and update the like count in the UI accordingly.
      if (res.ok) {
        const data = await res.json(); 
        // PESSIMISTIC MATH
        setReels(currentReels => currentReels.map(reel => {
          if (reel.id === id) {
            return { 
              ...reel, 
              likes: data.liked ? (reel.likes || 0) + 1 : Math.max(0, (reel.likes || 0) - 1) 
            };
          }
          return reel;
        }));
      }
    } catch (error) {
      console.error("Failed to update like in database:", error);

      // NETWORK ERROR ROLLBACK: If there was a network error or any other issue during the fetch request, we catch the error, 
      // log it, and rollback the optimistic UI update to maintain consistency with the actual like status in the database.
      setReels(currentReels => currentReels.map(reel =>
         reel.id === id ? { ...reel, userLiked: !isLiking } : reel
      ));
    }
  };

  // The Save Function (Optimistic UI for Bookmarks)
  const handleSave = async (id: number) => {
    // Similar to the like function, we first check if the user is authenticated by looking for a token in localStorage. 
    // If they are not logged in, we alert them and exit the function.
    const token = localStorage.getItem('glide_token');
    if (!token) {
      alert("Please log in to save reels!");
      return;
    }

    // We find the target reel in our current state to determine if we are saving or unsaving it. We then optimistically update 
    // the UI to reflect the new save status immediately for instant feedback.
    const targetReel = reels.find(r => r.id === id);
    if (!targetReel) return;
    const isSaving = !targetReel.userSaved;

    // OPTIMISTIC VISUALS ONLY (Instantly toggle the bookmark icon color)
    // We update the reels state by mapping through the current reels and toggling the userSaved property of the target reel.
    setReels(currentReels => currentReels.map(reel =>
      reel.id === id ? { ...reel, userSaved: isSaving } : reel
    ));

    // BACKEND UPDATE: We then send a POST request to the backend to update the save status in the database.
    try {
      const res = await apiFetch(`/api/reels/${id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      // ERROR HANDLING: If the response indicates that the user's session has expired (401 or 403), we alert the user, 
      // clear their session data, and rollback the optimistic UI update to reflect that the save action was not successful.
      if (res.status === 401 || res.status === 403) {
        alert("Your session expired. Please log in again.");
        localStorage.removeItem('glide_token');
        localStorage.removeItem('glide_user');
        
        // Rollback the visual if token fails
        setReels(currentReels => currentReels.map(reel =>
          reel.id === id ? { ...reel, userSaved: !isSaving } : reel
        ));
        return;
      }
    } catch (error) {
      console.error("Failed to update save in database:", error);
      // Rollback the visual if the user's WiFi drops mid-click
      setReels(currentReels => currentReels.map(reel =>
        reel.id === id ? { ...reel, userSaved: !isSaving } : reel
      ));
    }
  };

  // Share function to hit the backend tracking route and use Native Share
  const handleShare = async (id: number, video_id: string, title: string) => {
    const deepLink = `https://glidesports.app/reels?reelId=${video_id}`;
    
    // Tell the backend to increment the share counter (Background process)
    // We keep the fetch for your analytics, but REMOVED the setReels UI increment
    try {
        // Deliberately plain fetch, not apiFetch: this route never sends an auth header today
        fetch(`${API_BASE_URL}/api/reels/${id}/share`, { method: 'POST' });
    } catch (err) {
        console.error("Failed to track share in DB", err);
    }

    // Execute the actual share action using Capacitor Native Share
    try {
      await Share.share({
        title: 'Glide Reels',
        text: `Check out this highlight: ${title}`,
        url: deepLink,
        dialogTitle: 'Share with friends',
      });
    } catch (err: any) {
      console.error("Error sharing natively:", err);
      
      // Desktop fallback: Copy to Clipboard
      try {
        await navigator.clipboard.writeText(deepLink);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      } catch (copyErr) {
        console.error("Failed to copy to clipboard:", copyErr);
      }
    }
  };

  // The Logic for fetching and submitting comments from the drawer
  const openCommentDrawer = async (reel: any) => {
    setActiveReel(reel);
    setIsCommentDrawerOpen(true);
    setCommentsLoading(true);

    // Fetch comments for this reel from the backend
    try {
      // Deliberately plain fetch, not apiFetch: this route never sends an auth header today
      const res = await fetch(`${API_BASE_URL}/api/reels/${reel.id}/comments`);
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

  // The function to submit a new comment to the reel
  // We first check if the comment text is not empty and if there is an active reel. We also check for user authentication by looking for 
  // a token in localStorage. If the user is not authenticated, we alert them to log in.
  const submitComment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newCommentText.trim() || !activeReel) return;

    const token = localStorage.getItem('glide_token');
    if (!token) return alert("Please log in to comment.");

    // OPTIMISTIC UI UPDATE: We immediately add the new comment to the comments state to reflect it in the UI for instant feedback.
    try {
      const res = await apiFetch(`/api/reels/${activeReel.id}/comments`, {
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
        setReels(currentReels => currentReels.map(r => 
          r.id === activeReel.id ? { ...r, commentCount: (r.commentCount || 0) + 1 } : r
        ));
      } else {
        alert("Failed to post comment.");
      }
    } catch (err) {
      console.error("Error submitting comment:", err);
    }
  };

  // Handlers for Editing and Deleting Reel Comments
  // The handleEditSubmit function sends a PUT request to the backend to update the comment text. It first checks 
  // if the edited text is not empty, then it sends the request with the new text. If the update is successful, 
  // it updates the comments state to reflect the change in the UI and closes the edit mode. If there is an error, it alerts the user.
  const handleEditSubmit = async (commentId: number) => {
    if (!editCommentText.trim()) return;

    // We send a PUT request to the backend with the updated comment text. If the response is successful, we update the comments
    // state by mapping through the current comments and replacing the edited comment with the new text. We then exit edit mode
    // by setting editingCommentId to null. If there is an error during the fetch request, we catch it and log it to the console.
    try {
      const res = await apiFetch(`/api/reel_comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editCommentText })
      });

      if (res.ok) {
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

  // The handleDeleteComment function sends a DELETE request to the backend to remove a comment. It first confirms with the user 
  // if they want to delete the comment. If they confirm, it sends the DELETE request. If the deletion is successful, it updates 
  // the comments state to remove the deleted comment and decrements the comment count on the main feed. If there is an error, it alerts the user.
  const handleDeleteComment = async (commentId: number) => {
    if (!confirm("Are you sure you want to delete this take?")) return;

    // We send a DELETE request to the backend to remove the comment. If the response is successful, we update the comments state by filtering out
    // the deleted comment. We also update the reels state to decrement the comment count for the active reel. If there is an error during the fetch
    // request, we catch it and log it to the console.
    try {
      const res = await apiFetch(`/api/reel_comments/${commentId}`, {
        method: 'DELETE'
      });

      // If the deletion is successful, we remove the comment from the comments state and decrement the comment count on the main feed for the active reel.
      if (res.ok) {
        setComments(prev => prev.filter(c => c.id !== commentId));
        setReels(currentReels => currentReels.map(r => 
          r.id === activeReel.id ? { ...r, commentCount: Math.max(0, (r.commentCount || 1) - 1) } : r
        ));
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Failed to delete comment.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Pre-calculate active index before mapping to power the Virtualization window
  const activeIndex = reels.findIndex(r => r.id === activeReelId);

  // Determine which store to send the user to based on the OS detection logic.
  // We grab the 10-digit App Store ID from the environment variable. 
  const appleAppId = process.env.NEXT_PUBLIC_APPLE_APP_STORE_ID;
  const storeLink = isIOSBrowser 
    ? `https://apps.apple.com/us/app/glide-sports/id${appleAppId}` 
    : "https://play.google.com/store/apps/details?id=com.glidesports.app";

  return (
    // Swapped a plain screen-height unit for the dynamic viewport height unit, to prevent
    // layout jumps on mobile browsers. Subtracts --app-banner-height because <body> already
    // reserves that space at the top
    // for the sticky banner - without this, this "one full viewport" box would extend past
    // the true bottom of the screen by the banner's height, dragging the icon column and
    // metadata text down with it (worse on some navigations than others because mobile
    // Chrome's dvh value shifts as its own address bar shows/hides between navigations).
    <main className="bg-chalk dark:bg-black text-gray-900 dark:text-white h-[calc(100dvh_-_var(--app-banner-height))] overflow-hidden flex flex-col">

      {/* Pull-to-Refresh Indicator - tracks the drag gesture detected on the scroll container */}
      <PullToRefreshIndicator pullDistance={reelsPullDistance} isRefreshing={isReelsRefreshing} threshold={reelsPullThreshold} />

      {/* Desktop Navigation Bar (Hidden on Mobile) */}
      <div className="absolute top-10 w-full z-50 p-6 hidden md:flex justify-center pointer-events-none transition-all">
        <TopTabs active="reels" className="pointer-events-auto" />
      </div>

      {/* Loading check updated from 'page === 1' to 'reels.length === 0' */}
      {loading && reels.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400 animate-pulse font-medium">Tuning into the broadcast...</p>
        </div>
      ) : reels.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400 text-center px-4 leading-relaxed">
            No reels found. Please wait for a stable internet connection and refresh the page!
          </p>
        </div>
      ) : (
        /* The Scroll Snapping Container */
        // Removing pb-20 on mobile so the video stays entirely full screen edge-to-edge
        // overscroll-y-contain stops the browser's native pull-to-refresh/bounce from
        // firing alongside our own pull-to-refresh gesture below
        <div ref={reelsContainerRef} className="flex-1 overflow-y-scroll overscroll-y-contain snap-y snap-mandatory scrollbar-hide">
          
          {/* ADDED BRACES AROUND MAP FUNCTION FOR IF-STATEMENTS */}
          {reels.map((reel, index) => {
            
            // THE MOBILE PROMO CARD INTERCEPTOR 
            // If we are on a mobile browser and hit the 2nd reel (index 1), inject the promo card.
            if (isMobileBrowser && index === 1) {
              return (
                <div 
                  key="promo-card" 
                  data-id="-1" // <-- Explicitly set to -1 to safely trigger the pause logic
                  className="reel-container h-[calc(100dvh_-_var(--app-banner-height))] w-full flex flex-col items-center justify-center snap-center snap-always relative bg-black"
                >
                  {/* Reconfigured for app pre-launch footprint */}
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-black via-purple-900/40 to-black border-t border-purple-500/30">
                    <div className="bg-purple-600/20 p-6 rounded-full mb-6 border border-purple-500/50">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-3 drop-shadow-md">Glide Mobile</h2>
                    <p className="text-gray-400 mb-8 max-w-xs leading-relaxed">Flawless video playback, instant push notifications, and optimized highlight feeds are on the way.</p>
                    
                    {/* Updated button element to behave as a sleek, non-clickable launch indicator */}
                    <div className="bg-purple-600/30 border border-purple-500/50 text-purple-300 font-bold py-3.5 px-8 rounded-full text-base tracking-wide shadow-inner select-none cursor-default">
                      {isIOSBrowser ? 'Coming Soon to the Apple App Store' : 'Coming Soon to the Google Play Store'}
                    </div>
                  </div>
                </div>
              );
            }

            // Block rendering of anything past the promo card on mobile browsers so they can't scroll past it
            if (isMobileBrowser && index > 1) return null;

            return (
              // Included the data-video-id attribute onto your wrapping map block container to target scroll focus.
              // Added `snap-always` to completely block the user from over-swiping multiple videos at once
              <div 
                key={reel.id} 
                data-id={reel.id} // Used by the Intersection Observer
                data-video-id={reel.video_id}
                
                // Added overflow-hidden to the outermost container to trap any bleeding layers from the 120% scaled iframe
                // md:pt-24 reserves the band the absolutely-positioned TopTabs row occupies
                // (top-10 + p-6 ≈ 80px) so the centered video frame can never rise into it
                className="reel-container h-[calc(100dvh_-_var(--app-banner-height))] w-full flex flex-col items-center justify-center snap-center snap-always relative overflow-hidden will-change-transform md:pt-24 md:pb-6"
                
                style={{ transform: 'translateZ(0)' }}
              >
                {/* The Video Container */}
                {/* Full screen edge-to-edge on Mobile (w-full h-full rounded-none), Framed nicely on Desktop (md:max-w-md md:h-[85vh] md:rounded-xl).
                    md:max-h-full caps the 85vh frame to the container's padded content box, so on
                    short viewports it shrinks below the reserved tab band instead of overlapping it */}
                <div
                  className="w-full h-full md:max-w-md md:h-[85vh] md:max-h-full bg-black md:rounded-xl overflow-hidden shadow-2xl relative md:border border-gray-300 dark:border-gray-800"
                  // Fallback strict inset path to physically mask the boundaries of the GPU layer
                  style={{ clipPath: 'inset(0)' }}
                >
                  
                  {/* The Scale Trick Wrapper */}
                  <div className="absolute top-1/2 left-1/2 w-[120%] h-[120%] -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                    {/* Render Window Virtualization! 
                        We ONLY mount the heavy YouTube iframe if it is the currently active video, 
                        or the one immediately next/previous to it (index <= 1 on initial load). 
                        The rest stay completely unloaded until you scroll near them, instantly fixing the network bottleneck! */}
                    {(activeIndex === -1 ? index <= 1 : Math.abs(index - activeIndex) <= 1) && (
                      <iframe
                        id={`reel-player-${reel.id}`}
                        className="w-full h-full pointer-events-none" 
                        src={`https://www.youtube-nocookie.com/embed/${reel.video_id}?enablejsapi=1&autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1`}
                        title={reel.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        loading="lazy" // Added native lazy loading as a secondary optimization
                        onLoad={(e) => {
                          if (activeReelId === reel.id && isPlaying) {
                            const iframeNode = e.target as HTMLIFrameElement;
                            // Ensure initial load respects the global interaction state
                            if (!isGlobalMuted) {
                              iframeNode.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'unMute' }), '*');
                            }
                            iframeNode.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), '*');
                          }
                        }}
                      ></iframe>
                    )}
                  </div>

                  {/* Lowered transition duration to 230ms and set ease-linear for a snappier visual reveal */}
                  <div className={`absolute inset-0 z-10 pointer-events-none bg-black ${
                    (activeReelId === reel.id && (!isIOSBrowser || !isGlobalMuted))
                      ? 'opacity-0 transition-opacity duration-[230ms] delay-[230ms] ease-linear'
                      : 'opacity-100'
                  }`}>
                    <img 
                      src={`https://i.ytimg.com/vi/${reel.video_id}/hqdefault.jpg`} 
                      alt={reel.title}
                      className="w-full h-full object-cover scale-105"
                    />
                  </div>

                  {/* The "Tap to Unmute" Graphic. Only shows on the very first un-interacted video */}
                  {isGlobalMuted && activeReelId === reel.id && isPlaying && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-black/60 text-white px-5 py-2.5 rounded-full backdrop-blur-md flex items-center gap-2 animate-pulse pointer-events-none drop-shadow-xl">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.809L5 14H3a2 2 0 01-2-2V8a2 2 0 012-2h2l3.293-2.809a1 1 0 01.09-.011zM13.707 5.293a1 1 0 011.414 0 8.998 8.998 0 012.879 6.707 8.998 8.998 0 01-2.879 6.707 1 1 0 11-1.414-1.414 6.998 6.998 0 002.293-5.293 6.998 6.998 0 00-2.293-5.293 1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-bold tracking-wide">Tap to Unmute</span>
                    </div>
                  )}

                  {/* The Transparent Overlay (The Click Catcher) */}
                  <div 
                    className="absolute inset-0 z-20 cursor-pointer"
                    onClick={() => {
                      if (activeReelId === reel.id) {
                        
                        // The crucial fix! If the browser is currently muting the feed,
                        // the first tap will UNMUTE it without pausing the video. 
                        if (isGlobalMuted) {
                          setIsGlobalMuted(false);
                          const iframe = document.getElementById(`reel-player-${reel.id}`) as HTMLIFrameElement;
                          if (iframe && iframe.contentWindow) {
                            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute' }), '*');
                          }
                          return; // Exit early so we don't accidentally pause it!
                        }

                        // Normal Play/Pause functionality resumes after the first tap
                        const nextIsPlaying = !isPlaying;
                        setIsPlaying(nextIsPlaying);
                        
                        const iframe = document.getElementById(`reel-player-${reel.id}`) as HTMLIFrameElement;
                        if (iframe && iframe.contentWindow) {
                          if (nextIsPlaying) {
                            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), '*');
                          } else {
                            // Force a quick play then pause to clear YouTube's native 'Ended' screen, allowing our Play button to restart the reel natively.
                            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), '*');
                            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo' }), '*');
                          }
                        }
                      }
                    }}
                  >
                    {!isPlaying && activeReelId === reel.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-lg transition-all duration-300">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-white opacity-90 drop-shadow-2xl" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Right-Side Action Bar (Like, Comment, and Share) */}
                  {/* Mobile offset grows by the safe-area inset, same as the metadata text
                      block and the bottom nav bar below, so the share button never ends up
                      under the (safe-area-expanded) nav bar on tall-inset devices. Desktop
                      keeps a flat offset since the framed card layout has no safe area. */}
                  <div className="absolute right-4 bottom-[calc(7rem_+_var(--app-safe-bottom))] md:bottom-24 flex flex-col items-center space-y-4 z-40 pointer-events-auto">
                    
                    {/* Like Button */}
                    <button 
                      onClick={() => handleLike(reel.id)} 
                      className="flex flex-col items-center group transition-transform active:scale-90"
                    >
                      <div className="bg-black/40 p-2.5 rounded-full backdrop-blur-md mb-1 border border-white/10 group-hover:bg-black/60 transition-colors">
                        <svg 
                          xmlns="http://www.w3.org/2000/svg" 
                          className={`w-6 h-6 transition-colors ${reel.userLiked ? 'text-red-500' : 'text-white'}`} 
                          fill={reel.userLiked ? "currentColor" : "none"} 
                          viewBox="0 0 24 24" 
                          stroke="currentColor" 
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                      </div>
                      <span className="text-white text-xs font-semibold drop-shadow-md">{reel.likes || 0}</span>
                    </button>

                    {/* Comment Button */}
                    <button 
                      onClick={() => openCommentDrawer(reel)}
                      className="flex flex-col items-center group transition-transform active:scale-90"
                      title="View Discussion"
                    >
                      <div className="bg-black/40 p-2.5 rounded-full backdrop-blur-md mb-1 border border-white/10 group-hover:bg-black/60 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      {/* Render the comment count directly from the subquery data */}
                      <span className="text-white text-xs font-semibold drop-shadow-md">{reel.commentCount || 0}</span>
                    </button>

                    {/* Bookmark Button */}
                    <button 
                      onClick={() => handleSave(reel.id)} 
                      className="flex flex-col items-center group transition-transform active:scale-90"
                      title="Save this reel"
                    >
                      <div className="bg-black/40 p-2.5 rounded-full backdrop-blur-md mb-1 border border-white/10 group-hover:bg-black/60 transition-colors">
                        <svg 
                          xmlns="http://www.w3.org/2000/svg" 
                          className={`w-6 h-6 transition-colors ${reel.userSaved ? 'text-signal' : 'text-white'}`} 
                          fill={reel.userSaved ? "currentColor" : "none"} 
                          viewBox="0 0 24 24" 
                          stroke="currentColor" 
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                      </div>
                    </button>

                    {/* Share Button */}
                    <button 
                      onClick={() => handleShare(reel.id, reel.video_id, reel.title)} 
                      className="flex flex-col items-center group relative transition-transform active:scale-90"
                    >
                      <div className="bg-black/40 p-2.5 rounded-full backdrop-blur-md mb-1 border border-white/10 group-hover:bg-black/60 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                      </div>
                      
                      {copiedId === reel.id && (
                        <span className="absolute right-14 top-2 bg-white text-black text-xs font-bold px-3 py-1.5 rounded-lg shadow-xl whitespace-nowrap animate-bounce">
                          Copied!
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Video Metadata Overlay */}
                  {/* Pushed the metadata text up on mobile so it doesn't get hidden behind the
                      bottom navigation. Grows by the safe-area inset (same var used on the nav
                      bar itself) for the same reason the nav bar's own height does */}
                  <div className="absolute bottom-0 left-0 w-full p-6 pb-[calc(5rem_+_var(--app-safe-bottom))] md:pb-6 pr-20 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-30">
                    <h3 className="text-lg font-bold text-white leading-snug drop-shadow-lg">{reel.title}</h3>
                    <p className="text-sm text-gray-300 mt-2 font-medium bg-white/10 backdrop-blur-sm inline-block px-3 py-1 rounded-full shadow-sm">@{reel.channel_name}</p>
                  </div>
                </div>
              </div>
            );
          })} 
          {/* CLOSED MAP BRACES */}

          {/* Added !isMobileBrowser check here because we don't want the sentinel to appear on mobile browsers, which would allow users to scroll past the promo card. */}
          {/* Removed `snap-center` and reduced the height of the sentinel block. 
              This completely eliminates the glitchy infinite-snap loop when loading new videos! */}
          {hasMore && !isMobileBrowser && (
            <div id="reels-scroll-sentinel" className="h-24 w-full flex items-center justify-center shrink-0">
              {loadingMore && (
                <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              )}
            </div>
          )}

          {!hasMore && !isMobileBrowser && (
             <div className="h-24 w-full flex items-center justify-center shrink-0">
                <p className="text-gray-500 dark:text-gray-400 font-medium">You've caught up on all the highlights!</p>
             </div>
          )}
        </div>
      )}

      {/* The Sliding Comment Drawer for Reels */}
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

        {/* Post Context Banner (Mapped to activeReel.title) */}
        {activeReel && (
          <div className="p-4 bg-purple-50 dark:bg-purple-900/10 border-b border-gray-200 dark:border-gray-800">
            <p className="text-xs text-purple-600 dark:text-purple-400 font-bold uppercase mb-1">Discussing Highlight</p>
            <p className="text-sm font-semibold line-clamp-2">{activeReel.title}</p>
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
      {/* On reels, this bar overlays the video slightly with a sleek gradient, matching the TikTok/Instagram aesthetic */}
      <BottomNav active="reels" variant="overlay" />

    </main>
  );
}

// The new default export that wraps your Reels content in a Suspense boundary
// This prevents Next.js static build errors when using useSearchParams()
export default function Reels() {
  return (
    <Suspense 
      fallback={
        <div className="h-screen w-full bg-gray-100 dark:bg-black flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <ReelsContent />
    </Suspense>
  );
}