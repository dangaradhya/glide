"use client";

// A small floating spinner that tracks a pull-to-refresh gesture: it fades and rotates
// in as the user drags down, then spins in place once the threshold is crossed and the
// actual refetch is in flight. Shared by the Posts feed and the Reels feed.
export default function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold,
}: {
  pullDistance: number;
  isRefreshing: boolean;
  threshold: number;
}) {
  if (pullDistance === 0 && !isRefreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);

  return (
    <div
      // top offset = whatever space is actually reserved at the top (banner + notch on
      // web, just the notch on native - see --app-banner-height) plus a small gap, so
      // this sits right below it on every platform instead of assuming the banner exists
      className="fixed top-[calc(var(--app-banner-height)_+_12px)] left-1/2 z-50 flex items-center justify-center pointer-events-none"
      style={{
        transform: `translate(-50%, ${isRefreshing ? 12 : pullDistance * 0.6}px)`,
        opacity: isRefreshing ? 1 : progress,
        transition: isRefreshing ? 'transform 0.2s ease' : 'none',
      }}
    >
      <div className="w-9 h-9 rounded-full bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-800 flex items-center justify-center">
        <div
          className={`w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full ${isRefreshing ? 'animate-spin' : ''}`}
          style={!isRefreshing ? { transform: `rotate(${progress * 360}deg)` } : undefined}
        />
      </div>
    </div>
  );
}
