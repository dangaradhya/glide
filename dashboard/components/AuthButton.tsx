"use client";

// IMPORTS
import { useState, useEffect } from 'react';
// import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import Link from 'next/link'; 
// Import useTheme to track light/dark mode
import { useTheme } from 'next-themes';

// AuthButton component handles Google OAuth login/logout and displays user info
export default function AuthButton() {
  // State to hold user information after successful login 
  const [user, setUser] = useState<{ name: string; picture: string } | null>(null);
  // Access theme state
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    // This tells the native phone OS which Google project to authenticate against
    GoogleAuth.initialize({
      clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
      scopes: ['profile', 'email'],
      grantOfflineAccess: true,
    });
  }, []);

  // Check if a user is already logged in when the component mounts
  useEffect(() => {
    const storedUser = localStorage.getItem('glide_user');

    // If user data exists in localStorage, parse it and set it to state for display
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Handles successful Google login by sending the token to the backend and storing the Glide JWT and user data
  const handleLogin = async () => {
    try {
      // This line opens the native Android/iOS account selector, or a web popup if on laptop!
      const googleUser = await GoogleAuth.signIn();

      // Send the Google token to our Express backend
      const res = await fetch('https://glide-sports.onrender.com/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Extracted the token from the native Capacitor response object
        body: JSON.stringify({ token: googleUser.authentication.idToken }),
      });

      // Parse the response from the backend, which should include the Glide JWT and user data
      const data = await res.json();

      // If the login is successful, store the Glide JWT and user data securely in localStorage
      if (res.ok) {
        // Store the Glide JWT and user data in localStorage for session persistence across page reloads
        localStorage.setItem('glide_token', data.token);
        localStorage.setItem('glide_user', JSON.stringify(data.user));
        setUser(data.user);
        
        // Force a hard reload to pull the user's personalized feed and likes
        window.location.reload();
      } else {
        console.error("Login failed:", data.error);
      }
    } catch (error) {
      console.error("Network error during login:", error);
    }
  };

  // Handles user logout by clearing the Google session and removing stored tokens
  // Made the function async to await the native Capacitor logout
  const handleLogout = async () => {
    try {
      // Call the native plugin to clear the session
      await GoogleAuth.signOut();
    } catch (e) {
      console.error("Native logout skipped or failed");
    }
    
    localStorage.removeItem('glide_token');
    localStorage.removeItem('glide_user');
    setUser(null);
    
    // Force a hard reload to instantly wipe all personalized UI state 
    window.location.reload();
  };
  
  // If a user is logged in, display their profile picture, name, and a logout button.
  if (user) {
    return (
      // Dynamic light/dark backgrounds, borders, and text colors
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

        <button 
          onClick={handleLogout}
          className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors ml-2 border-l border-gray-200 dark:border-white/20 pl-3"
        >
          Logout
        </button>
      </div>
    );
  }

  // If no user is logged in, render the Google Login button
  // Replaced the <GoogleLogin> component with a custom HTML button that triggers handleLogin
  return (
    <div className="shadow-lg rounded-full overflow-hidden border border-gray-200 dark:border-gray-700">
        <button
          onClick={handleLogin}
          className={`flex items-center px-4 py-2 text-sm font-medium transition-colors ${
            resolvedTheme === 'dark' 
              ? 'bg-black text-white hover:bg-gray-900' 
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {/* Custom Google "G" Logo SVG for a professional native look */}
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
}