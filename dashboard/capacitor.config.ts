import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.glidesports.glide',
  appName: 'Glide',
  webDir: 'out',
  plugins: {
    GoogleAuth: {
      scopes: ["profile", "email"],
      serverClientId: "911833440641-qmov0dpnu3hb4ec53gojc00tgthtiq2p.apps.googleusercontent.com",
      forceCodeForRefreshToken: true
    }
  }
};

export default config;