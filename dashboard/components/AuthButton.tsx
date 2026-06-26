"use client";

// IMPORTS
import { useState, useEffect } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { Capacitor } from '@capacitor/core';
import Link from 'next/link'; 
import { useTheme } from 'next-themes';

// AuthButton Component - Handles both Web and Native Google Authentication
export default function AuthButton() {
  const [user, setUser] = useState<{ name: string; picture: string } | null>(null);
  const { resolvedTheme } = useTheme();
  
  // Added state to track if component is mounted, if the platform is native, if the platform is iOS, and if the modal is shown
  const [mounted, setMounted] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Check if the platform is native (iOS or Android)
    const nativePlatform = Capacitor.isNativePlatform();
    setIsNative(nativePlatform);
    
    // Check if the specific native platform is iOS
    setIsIOS(Capacitor.getPlatform() === 'ios');

    // Initialize GoogleAuth for native platforms
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

  // Function to authenticate with the server using the Google token
  const authenticateWithServer = async (token: string) => {
    try {
      const res = await fetch('https://glide-sports.onrender.com/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      // If the server response is OK, store the token and user data in localStorage, update the user state, close the modal, and reload the page
      if (res.ok) {
        localStorage.setItem('glide_token', data.token);
        localStorage.setItem('glide_user', JSON.stringify(data.user));
        setUser(data.user);
        setShowModal(false); 
        window.location.reload();
      }
    } catch (error: any) {
      console.error("Network Fetch Failed: ", error.message);
    }
  };

  // Function to authenticate with the server using the Apple token and optional name
  const authenticateAppleWithServer = async (token: string, name?: string) => {
    try {
      const res = await fetch('https://glide-sports.onrender.com/api/auth/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name }), 
      });

      const data = await res.json();

      // If the server response is OK, store the token and user data in localStorage, update the user state, close the modal, and reload the page
      if (res.ok) {
        localStorage.setItem('glide_token', data.token);
        localStorage.setItem('glide_user', JSON.stringify(data.user));
        setUser(data.user);
        setShowModal(false); 
        window.location.reload();
      }
    } catch (error: any) {
      console.error("Apple Network Fetch Failed: ", error.message);
    }
  };

  // Handle successful login for web Google authentication
  const handleWebLoginSuccess = async (credentialResponse: any) => {
    if (!credentialResponse.credential) return;
    await authenticateWithServer(credentialResponse.credential);
  };

  // Handle native Google login
  const handleNativeLogin = async () => {
    try {
      const googleUser = await GoogleAuth.signIn();
      if (!googleUser.authentication.idToken) return;
      await authenticateWithServer(googleUser.authentication.idToken);
    } catch (error: any) {
      console.error("Native Login Error: ", error);
    }
  };

  // Handle Apple login
  const handleAppleLogin = async () => {
    try {
      const { response } = await SignInWithApple.authorize({
        clientId: process.env.NEXT_PUBLIC_APPLE_CLIENT_ID || '',
        redirectURI: 'https://glide-sports.onrender.com/api/auth/apple',
        scopes: 'email name',
      });
      
      // Apple only sends the name object on the very first login
      const fullName = response.givenName ? `${response.givenName} ${response.familyName}` : undefined;
      
      // If the response contains an identity token, authenticate with the server
      if (response.identityToken) {
         await authenticateAppleWithServer(response.identityToken, fullName);
      }
    } catch (error) {
      console.error("Apple Login Error: ", error);
    }
  };

  // Handle logout for both native and web platforms
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

  // Render the component based on the user's authentication state
  if (!mounted) {
    return <div className="w-[100px] h-[36px] opacity-0"></div>;
  }
  
  // If the user is authenticated, display their profile picture, name, and a logout button
  if (user) {
    return (
      <div className="flex items-center space-x-3 bg-white dark:bg-white/10 rounded-full pr-4 p-1 backdrop-blur-md border border-gray-200 dark:border-white/20 shadow-sm dark:shadow-lg">
        <Link href="/profile" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
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

  // If the user is not authenticated, display a "Sign In" button that opens the modal 
  // The modal contains options for Google and Apple sign-in, depending on the platform (web or native).
  // The modal also includes a close button and links to the Terms and Privacy Policy.
  return (
    <>
      <button 
        onClick={() => setShowModal(true)} 
        className="px-5 py-2 rounded-full font-bold text-sm bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-md active:scale-95"
      >
        Sign In
      </button>

      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          
          <div className="w-full max-w-[400px] bg-[#0F1117] rounded-3xl p-8 border border-white/10 shadow-2xl relative">
            
            <button 
              onClick={() => setShowModal(false)}
              className="absolute top-5 right-5 text-gray-500 hover:text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="flex items-center text-xs tracking-widest text-gray-400 mb-4 font-semibold uppercase">
              <span className="w-2 h-2 rounded-full bg-pink-500 mr-3 animate-pulse"></span>
              Sign In
            </div>
            
            <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">Continue to Glide</h2>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
              Sign in to save highlights, drop takes, and sync your account. 
            </p>

            <div className="space-y-4">
              
              {isNative ? (
                <button 
                  onClick={handleNativeLogin} 
                  className="flex items-center justify-center w-full py-3.5 px-4 rounded-2xl border border-gray-700 bg-transparent hover:bg-white/5 text-white font-medium transition-colors active:scale-[0.98]"
                >
                  <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </button>
              ) : (
                <div className="w-full flex justify-center [&>div]:w-full overflow-hidden rounded-2xl border border-gray-700 hover:border-gray-500 transition-colors">
                  <GoogleLogin
                    onSuccess={handleWebLoginSuccess}
                    onError={() => console.error('Google Web Form Error: Login Failed')}
                    theme="filled_black"
                    shape="rectangular"
                    size="large"
                    width="100%"
                    text="continue_with"
                  />
                </div>
              )}

              {isIOS && (
                <button 
                  onClick={handleAppleLogin} 
                  className="flex items-center justify-center w-full py-3.5 px-4 rounded-2xl border border-gray-700 bg-transparent hover:bg-white/5 text-white font-medium transition-colors active:scale-[0.98]"
                >
                  <svg className="w-5 h-5 mr-3 mb-1 fill-white" viewBox="0 0 24 24">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.17 2.24-.86 3.44-.8 1.48.05 2.75.69 3.48 1.83-3.13 1.76-2.58 5.76.28 6.84-.71 1.85-1.74 3.54-2.28 4.3zm-3.51-14.8c-.89.1-1.85-.4-2.5-1.15-.65-.79-.98-1.92-.81-2.92.93-.07 1.94.43 2.58 1.18.67.78.96 1.81.73 2.89z" />
                  </svg>
                  Continue with Apple
                </button>
              )}

            </div>

            <p className="text-xs text-gray-500 mt-8 text-center">
              By continuing you agree to our <Link href="#" className="text-gray-400 hover:text-white transition-colors underline decoration-gray-600 underline-offset-2">Terms of Service</Link> and <Link href="#" className="text-gray-400 hover:text-white transition-colors underline decoration-gray-600 underline-offset-2">Privacy Policy</Link>.
            </p>

          </div>
        </div>
      )}
    </>
  );
}
