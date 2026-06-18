"use client";

// IMPORTS
import { useState, useEffect } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import Link from 'next/link'; 
// Import useTheme to track light/dark mode
import { useTheme } from 'next-themes';

// AuthButton component handles Google OAuth login/logout and displays user info
export default function AuthButton() {
  // State to hold user information after successful login 
  const [user, setUser] = useState<{ name: string; picture: string } | null>(null);
  // Access theme state
  const { resolvedTheme } = useTheme();

  // Check if a user is already logged in when the component mounts
  useEffect(() => {
    const storedUser = localStorage.getItem('glide_user');

    // If user data exists in localStorage, parse it and set it to state for display
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Handles successful Google login by sending the token to the backend and storing the Glide JWT and user data
  const handleSuccess = async (credentialResponse: any) => {
    try {
      // Send the Google token to our Express backend
      const res = await fetch('https://glide-sports.onrender.com/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: credentialResponse.credential }),
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
  const handleLogout = () => {
    googleLogout();
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
  return (
    // Wrapper adapts to theme, and GoogleLogin theme prop reacts to resolvedTheme
    <div className="shadow-lg rounded-full overflow-hidden border border-gray-200 dark:border-gray-700">
        <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => console.error('Google Login Failed')}
            theme={resolvedTheme === 'dark' ? 'filled_black' : 'outline'}
            shape="pill"
            text="continue_with"
        />
    </div>
  );
}