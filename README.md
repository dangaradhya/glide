# ⚡️ Glide Sports

**The AI-Powered Sports Aggregator for the Modern Fan.**

🌐 **Live Web App:** [glidesports.app](https://glidesports.app)

Glide is a full-stack, cross-platform sports media application designed to cut through the noise of traditional sports journalism. It delivers AI-curated news feeds, infinite-scroll highlight reels, personalized match tracking, and an interactive community discussion engine—all wrapped in a highly optimized, native-feeling UI.

---

## ✨ Core Features

### 📰 AI-Curated News Feed
A pristine, distraction-free feed of the latest sports news. Glide utilizes automated web scrapers that pass raw sports data through the **Google Gemini API**. Gemini extracts the core context, removes clickbait, and generates clean, digestible headlines and summaries before passing them to the client.

### 🎬 Infinite-Scroll Reels (YouTube Integration)
A TikTok/Instagram-style vertical video feed dedicated to sports highlights. Powered by the **YouTube Data API v3**, the feed uses an advanced `IntersectionObserver` to track viewport position. It autonomously handles playback states—muting, unmuting, playing, and pausing—ensuring only the focal video consumes bandwidth, providing a flawless mobile swiping experience.

### 💬 The "Fan Zone" Discussion Engine
A highly interactive comment system attached to every post and reel. 
* **Real-Time Feel:** Utilizes **Optimistic UI** to instantly render comments before server confirmation.
* **Security:** Features a secure 15-minute edit/delete window. This constraint is enforced on the frontend UI and cryptographically verified on the Express backend using UTC timestamps to prevent API tampering.
* **Custom Profiles:** Users interact using custom display names and avatars seamlessly synced from their Google or Apple accounts.

### 📊 Personalized Match Center
A customizable dashboard tracking live scores and upcoming fixtures. Users select their favorite leagues (stored relationally in the SQLite backend), and the Match Center dynamically renders only the data they care about, filtering out irrelevant sports.

### 🔍 FTS5 Global Smart Search
Lightning-fast search across all articles, reels, and channels. Instead of slow `LIKE %query%` SQL statements, Glide utilizes a custom **SQLite FTS5 (Full-Text Search) Virtual Table**. It features a debounced, predictive dropdown UI that routes users instantly to the exact post or video they searched for.

### 📱 Native Deep-Linking & Auto-Seek Engine
When a user shares a specific post or reel via the **Capacitor Native Share API**, the URL is injected with a specific parameter (e.g., `#post-123` or `?reelId=abc`). When a recipient opens the link, the Next.js frontend hydrates the database state and fires a custom "Auto-Seek" engine that actively fetches pagination blocks until it locates the target DOM node, smoothly centering it on the screen with a highlight animation.

---

## 🏗 System Architecture & Tech Stack

Glide is built on a highly optimized, decoupled architecture separating the client application from the data-ingestion and API layers.

### **Frontend (Client Application)**
* **Framework:** Next.js (App Router) & React
* **Language:** TypeScript
* **Styling:** Tailwind CSS (Dark/Light mode native, responsive safe-area insets)
* **Mobile Wrapper:** Capacitor.js (Compiles the web app into native iOS & Android binaries)
* **State Management:** React Hooks with highly synchronized Optimistic UI rendering
* **Deployment:** Vercel (Edge network delivery)

### **Backend (API & Data Layer)**
* **Framework:** Node.js with Express.js
* **Database:** SQLite3 (Local file-based for blazing-fast read/writes, ideal for read-heavy news apps)
* **Search Engine:** SQLite FTS5 Virtual Tables with automated Trigger syncs
* **Deployment:** Render (Web Service)

### **Authentication & Security**
* **Providers:** Google OAuth 2.0 & Apple Sign-In
* **Session Management:** JWT (JSON Web Tokens) verified via strict Express middleware.
* **Cross-Platform Sync:** Custom database-first profile syncing designed to bypass aggressive iOS Safari ITP (Intelligent Tracking Prevention) constraints.

### **DevOps, Telemetry & Observability**
* **Error Tracking:** Sentry (Node.js profiling and deep Express error capturing).
* **Product Analytics:** PostHog (User session tracking, feature usage, and conversion metrics mapped to anonymized user IDs).

---
