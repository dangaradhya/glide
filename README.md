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

## 📦 Building the native apps

### JDK requirement: 21, and not newer

The Android build sits in a narrow JDK window:

* **Below 21** fails — Capacitor 8 compiles its Android libraries at Java 21 (`invalid source release: 21`).
* **25 and up** fails — Gradle 8.14.3's Groovy cannot read class file major version 69 (`Unsupported class file major version 69`).

So use a **full JDK 21–24 that includes `jlink`**. A trimmed JetBrains runtime without `jlink` fails later in the build (`jlink executable ... does not exist`), so IntelliJ's bundled JBR will not work.

⚠️ Current Android Studio bundles JDK 25, which is *too new*. Point **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK** at a 21 rather than the bundled default.

### Debug build

```bash
cd dashboard
npm run build                  # Next.js static export -> dashboard/out
npx cap sync android           # copy web assets + refresh native plugins

cd android
JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=$HOME/Android/Sdk ./gradlew assembleDebug
```

Run `npm run build` before every `cap sync` — Capacitor copies `dashboard/out`, so skipping it ships whatever web assets were there last.

### Release build (signed)

Release signing reads `android/keystore.properties`, which is gitignored. Without it, `assembleRelease` and `bundleRelease` fail with an explicit message rather than emitting an unsigned artifact.

**One-time setup.** Generate the upload keystore and keep it somewhere backed up outside the repo:

```bash
keytool -genkeypair -v -keystore glide-release.jks \
  -alias glide -keyalg RSA -keysize 2048 -validity 10000
```

Then `cp android/keystore.properties.example android/keystore.properties` and fill in the four values (`storeFile` resolves relative to `android/`, or use an absolute path).

> 🔑 **Back up the keystore and its passwords.** Google Play ties the listing to this key — lose it and you can never publish an update to the same app; leak it and someone else can sign builds as you.

```bash
cd dashboard/android
JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=$HOME/Android/Sdk ./gradlew bundleRelease
# -> app/build/outputs/bundle/release/app-release.aab   (this is what Play wants)
```

### Google Sign-In needs the release certificate registered

The Google OAuth Android client is keyed to the signing certificate's SHA-1, and the release keystore's SHA-1 differs from the debug one. Sign-in can therefore work in every debug build and fail in the Play build unless the release fingerprint is registered first:

```bash
keytool -list -v -keystore glide-release.jks -alias glide | grep SHA1
```

Add that fingerprint to the Android OAuth client in the Google Cloud Console alongside the existing debug one. If Play App Signing is enabled, also register the **App signing key** SHA-1 that Play shows after the first upload — Play re-signs the AAB with its own key, so the certificate users actually run is Play's, not yours.

---
