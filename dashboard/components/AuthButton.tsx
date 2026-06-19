"use client";

// IMPORTS
import { useState, useEffect } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { Capacitor } from '@capacitor/core';
import Link from 'next/link'; 
import { useTheme } from 'next-themes';

// AuthButton Component - Handles both Web and Native Google Authentication
export default function AuthButton() {
  const [user, setUser] = useState<{ name: string; picture: string } | null>(null);
  const { resolvedTheme } = useTheme();
  
  // Added state to track if component is mounted and if we're on a native platform
  const [mounted, setMounted] = useState(false);

  // State to track if we're running in a native environment (Capacitor) or web
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Determine if we're running in a native environment and initialize GoogleAuth if so
    const nativePlatform = Capacitor.isNativePlatform();
    setIsNative(nativePlatform);

    // Only initialize GoogleAuth if we're on a native platform to avoid unnecessary errors in web environments
    if (nativePlatform) {
      try {
        GoogleAuth.initialize({
          clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
          scopes: ['profile', 'email'],
          grantOfflineAccess: true,
        });
      } catch (e) {
        console.error("Capacitor Init Error: ", e);
      }
    }

    const storedUser = localStorage.getItem('glide_user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Shared function to send the token to your Render backend
  const authenticateWithServer = async (token: string) => {

    // Added try-catch to handle network errors or if Render is offline, which would previously cause silent failures
    try {
      const res = await fetch('https://glide-sports.onrender.com/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('glide_token', data.token);
        localStorage.setItem('glide_user', JSON.stringify(data.user));
        setUser(data.user);
        window.location.reload();
      } else {
        // Silently log what your backend is complaining about
        console.error("Backend Rejected Login: ", data.error || "Unknown error");
      }
    } catch (error: any) {
      // Silently catch CORS issues or if Render is completely offline
      console.error("Network Fetch Failed: ", error.message);
    }
  };

  const handleWebLoginSuccess = async (credentialResponse: any) => {
    if (!credentialResponse.credential) {
      console.error("Google didn't return a web token!");
      return;
    }
    await authenticateWithServer(credentialResponse.credential);
  };

  const handleNativeLogin = async () => {
    try {
      const googleUser = await GoogleAuth.signIn();
      if (!googleUser.authentication.idToken) {
        console.error("Google didn't return a native token!");
        return;
      }
      await authenticateWithServer(googleUser.authentication.idToken);
    } catch (error: any) {
      // Silently catch if the Android Google pop-up is dismissed or crashes (e.g., error 12501)
      console.error("Native Login Error: ", error);
    }
  };

  // Added logout handling for both platforms, and also clear localStorage and reload the page to reset the app state
  const handleLogout = async () => {
    if (isNative) {
      try { await GoogleAuth.signOut(); } catch (e) {}
    } else {
      googleLogout();
    }
    
    localStorage.removeItem('glide_token');
    localStorage.removeItem('glide_user');
    setUser(null);
    window.location.reload();
  };

  // Added a loading state to prevent flashing the login button before we know if the user is logged in or not, which can be jarring especially on slow connections
  if (!mounted) {
    return <div className="w-[180px] h-[36px] opacity-0"></div>;
  }
  
  // If the user is logged in, show their profile picture and name with a logout button. Otherwise, show the appropriate login button based on the platform.
  if (user) {
    return (
      <div className="flex items-center space-x-3 bg-white dark:bg-white/10 rounded-full pr-4 p-1 backdrop-blur-md border border-gray-200 dark:border-white/20 shadow-sm dark:shadow-lg">
        <Link href="/profile" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
              src={user.picture} 
              alt="Profile" 
              className="w-8 h-8 rounded-full border border-gray-200 dark:border-white/50" 
              referrerPolicy="no-referrer"
          />
          <span className="text-sm font-medium text-gray-800 dark:text-white cursor-pointer">{user.name.split(' ')[0]}</span>
        </Link>
        <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors ml-2 border-l border-gray-200 dark:border-white/20 pl-3">
          Logout
        </button>
      </div>
    );
  }

  // If we're on a native platform, show the native login button. Otherwise, show the web login button. Both buttons are styled to match the overall design of the app and provide visual feedback on hover.
  if (isNative) {
    return (
      <div className="shadow-lg rounded-full overflow-hidden border border-gray-200 dark:border-gray-700">
          <button onClick={handleNativeLogin} className={`flex items-center px-4 py-2 text-sm font-medium transition-colors ${resolvedTheme === 'dark' ? 'bg-black text-white hover:bg-gray-900' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>
      </div>
    );
  } else {
    return (
      <div className="shadow-lg rounded-full overflow-hidden border border-gray-200 dark:border-gray-700">
          <GoogleLogin
              onSuccess={handleWebLoginSuccess}
              onError={() => console.error('Google Web Form Error: Login Failed')}
              theme={resolvedTheme === 'dark' ? 'filled_black' : 'outline'}
              shape="pill"
              text="continue_with"
          />
      </div>
    );
  }
}