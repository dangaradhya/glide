"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

// How far the user must drag down (in px) before releasing triggers a refresh
const PULL_THRESHOLD = 80;
// Visual cap so the indicator can't be dragged further than this, even on a long pull
const MAX_PULL = 120;

// Detects an Instagram-style "pull down from the top to refresh" gesture, either on
// `window` (pass { windowScroll: true } for a page that scrolls the whole document) or
// on a specific scrollable element (attach the returned `containerRef` callback ref to it).
//
// The container case intentionally returns a *callback* ref rather than accepting a plain
// useRef object from the caller: a plain ref object's identity never changes, so an effect
// keyed on it only ever sees whatever `.current` was at the very first render. On the Reels
// page, the scrollable div is behind a loading state and doesn't exist yet on first render,
// so that approach silently bound the gesture to the wrong target (the window) forever.
// A callback ref re-fires - and re-triggers this hook's effect - the instant the real DOM
// node mounts (or swaps out), so the listeners always end up on the actual scroll container.
export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  options?: { windowScroll?: boolean }
) {
  const windowScroll = options?.windowScroll ?? false;

  const [node, setNode] = useState<HTMLElement | null>(null);
  const containerRef = useCallback((el: HTMLElement | null) => {
    setNode(el);
  }, []);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);

  // Stashed in a ref so the effect below never needs to depend on the caller's
  // (often inline) onRefresh function - re-creating that function every render would
  // otherwise tear down and re-attach the touch listeners mid-gesture.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    // For the container case, wait until the real DOM node has actually mounted
    if (!windowScroll && !node) return;

    const target: HTMLElement | Window = windowScroll ? window : (node as HTMLElement);
    const getScrollTop = () => (windowScroll ? window.scrollY : (node as HTMLElement).scrollTop);

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current || getScrollTop() > 0) return;
      startYRef.current = e.touches[0].clientY;
      draggingRef.current = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current || startYRef.current === null) return;
      const delta = e.touches[0].clientY - startYRef.current;

      // Bail out if the user is dragging up, or has scrolled away from the top mid-gesture
      if (delta <= 0 || getScrollTop() > 0) {
        draggingRef.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      // Damped so the indicator feels like it has resistance, similar to Instagram's
      const damped = Math.min(delta * 0.5, MAX_PULL);
      pullDistanceRef.current = damped;
      setPullDistance(damped);
    };

    const handleTouchEnd = async () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      startYRef.current = null;

      if (pullDistanceRef.current >= PULL_THRESHOLD) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        try {
          await onRefreshRef.current();
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    target.addEventListener('touchstart', handleTouchStart as EventListener, { passive: true });
    target.addEventListener('touchmove', handleTouchMove as EventListener, { passive: true });
    target.addEventListener('touchend', handleTouchEnd as EventListener, { passive: true });

    return () => {
      target.removeEventListener('touchstart', handleTouchStart as EventListener);
      target.removeEventListener('touchmove', handleTouchMove as EventListener);
      target.removeEventListener('touchend', handleTouchEnd as EventListener);
    };
  }, [node, windowScroll]);

  return { pullDistance, isRefreshing, threshold: PULL_THRESHOLD, containerRef };
}
