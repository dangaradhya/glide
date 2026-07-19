// components/AuthButton.tsx
"use client";

import { useState, useEffect } from 'react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { Capacitor } from '@capacitor/core';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { API_BASE_URL } from '@/lib/api';

// AuthButton handles user authentication via Google and Apple, both for web and native platforms. 
// It manages user state, modal visibility, and communicates with the backend server for token verification and user data retrieval.
export default function AuthButton() {
  const [user, setUser] = useState<{ name: string; picture: string } | null>(null);
  const { resolvedTheme } = useTheme();
  
  // We use a mounted state to ensure that the component only renders after the client-side has fully loaded, 
  // preventing hydration mismatches in Next.js. isNative is used to determine if the app is running in a native environment 
  // (iOS or Android) via Capacitor.
  const [mounted, setMounted] = useState(false);
  const [isNative, setIsNative] = useState(false);
  
  // We swapped isIOS for isAppleDevice and now parse the userAgent. 
  // This correctly targets Native iOS, Mobile Safari, and Desktop macOS Safari.
  const [isAppleDevice, setIsAppleDevice] = useState(false);  

  // Modal state to control the visibility of the sign-in options.
  const [showModal, setShowModal] = useState(false);

  // SignInPrompt's "Sign in" CTA rings this doorbell from anywhere on the page -
  // the modal and every OAuth handler stay right here, untouched.
  useEffect(() => {
    const open = () => setShowModal(true);
    window.addEventListener('glide:open-auth', open);
    return () => window.removeEventListener('glide:open-auth', open);
  }, []);

  // Track stable variable scope for life-cycle dependency
  const userAgentString = typeof window !== 'undefined' ? window.navigator.userAgent : '';
  const isAppleSystem = /Macintosh|iPhone|iPad|iPod/i.test(userAgentString);
  const isStrictlyAppleDevice = isAppleSystem && !/Android|Windows|Linux/i.test(userAgentString);

  useEffect(() => {
    setMounted(true);

    // Determine if the app is running on a native platform (iOS or Android) using Capacitor.
    const nativePlatform = Capacitor.isNativePlatform();
    setIsNative(nativePlatform);
    
    setIsAppleDevice(isStrictlyAppleDevice);
    
    // Initialize GoogleAuth for native platforms. This is necessary for handling Google sign-in in Capacitor apps.
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

    // When the Render backend redirects back to the frontend, it attaches the tokens to the URL.
    // We catch them here, save them, clean the URL silently, and log the user in immediately.
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const urlUser = urlParams.get('user');

    // If we routed back from the Terms/Privacy page via the Back to App button, 
    // pop the modal back open and clean the URL parameter.
    const showLogin = urlParams.get('showLogin');
    if (showLogin === 'true') {
      setShowModal(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (urlToken && urlUser) {
      localStorage.setItem('glide_token', urlToken);
      localStorage.setItem('glide_user', decodeURIComponent(urlUser));
      
      const parsedUser = JSON.parse(decodeURIComponent(urlUser));
      
      // Link the user to PostHog for analytics tracking, using the user ID and other relevant information.
      import('posthog-js').then(({ default: ph }) => {
        ph.identify(parsedUser.id.toString(), {
          email: parsedUser.email,
          name: parsedUser.name,
          avatar: parsedUser.picture
        });
      }).catch(() => console.warn("Analytics blocked by browser"));

      // Silently clean the URL to hide the tokens from the address bar
      window.history.replaceState({}, document.title, window.location.pathname);
      setUser(parsedUser);
      window.location.reload();
      return; 
    }

    const storedUser = localStorage.getItem('glide_user');
    // If we have a user stored in localStorage, we parse it and set it in the state. We also identify the user in PostHog for analytics tracking.
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);

      // This prevents iOS Safari's native tracking blocker from crashing the login loop
      import('posthog-js').then(({ default: ph }) => {
        ph.identify(parsedUser.id.toString(), {
          name: parsedUser.name
        });
      }).catch(() => console.warn("Analytics blocked by browser"));
    }
  }, [isStrictlyAppleDevice]);

  // The authenticateWithServer function sends the Google ID token to the backend server for verification. If successful, it stores 
  // the returned token and user data in localStorage and updates the user state.
  const authenticateWithServer = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      
      // If the server responds with a successful status, we store the authentication token and user information in localStorage, 
      // update the user state, close the modal, and reload the page to reflect the authenticated state.
      if (res.ok) {
        localStorage.setItem('glide_token', data.token);
        localStorage.setItem('glide_user', JSON.stringify(data.user));
        
        // Non-blocking telemetry identification to prevent iOS Safari's native tracking blocker from crashing the login loop
        import('posthog-js').then(({ default: ph }) => {
          ph.identify(data.user.id.toString(), {
            email: data.user.email,
            name: data.user.name,
            avatar: data.user.picture
          });
        }).catch(() => console.warn("Analytics blocked by browser"));

        setUser(data.user);
        setShowModal(false); 
        window.location.reload();
      } 
      else {
        console.error("Backend Google Auth Error Status:", res.status, data);
      }
    } catch (error: any) {
      console.error("Network Fetch Failed: ", error.message);
    }
  };

  // The authenticateAppleWithServer function is similar to authenticateWithServer but is specifically for handling Apple Sign-In. 
  // It sends the Apple identity token and optional user name to the backend server for verification.
  const authenticateAppleWithServer = async (token: string, name?: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/apple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name }), 
      });

      const data = await res.json();
      
      // If the server responds with a successful status, we store the authentication token and user information in localStorage,
      if (res.ok) {
        localStorage.setItem('glide_token', data.token);
        localStorage.setItem('glide_user', JSON.stringify(data.user));
        
        // Non-blocking telemetry identification to prevent iOS Safari's native tracking blocker from crashing the login loop
        import('posthog-js').then(({ default: ph }) => {
          ph.identify(data.user.id.toString(), {
            email: data.user.email,
            name: data.user.name,
            avatar: data.user.picture
          });
        }).catch(() => console.warn("Analytics blocked by browser"));

        setUser(data.user);
        setShowModal(false); 
        window.location.reload();
      } 
      else {
        console.error("Backend Apple Auth Error Status:", res.status, data);
      }
    } catch (error: any) {
      console.error("Apple Network Fetch Failed: ", error.message);
    }
  };

  // The handleWebLoginSuccess function is triggered when a user successfully logs in via the Google web login. It extracts the 
  // credential from the response and calls authenticateWithServer to verify the token with the backend.
  const handleWebLoginSuccess = async (credentialResponse: any) => {
    if (!credentialResponse.credential) return;
    await authenticateWithServer(credentialResponse.credential);
  };

  // The handleNativeLogin function is used for native platforms (iOS/Android) to initiate the Google sign-in process. It calls
  const handleNativeLogin = async () => {
    try {
      const googleUser = await GoogleAuth.signIn();
      if (!googleUser.authentication.idToken) return;
      await authenticateWithServer(googleUser.authentication.idToken);
    } catch (error: any) {
      console.error("Native Login Error: ", error);
    }
  };

  // The handleAppleLogin function is used to initiate the Apple Sign-In process. It calls the SignInWithApple plugin to authorize the user, 
  // retrieves the identity token and optional full name, and then calls authenticateAppleWithServer to verify the token with the backend.
  const handleAppleLogin = async () => {
    try {
      if (isNative) {
        const { response } = await SignInWithApple.authorize({
          clientId: process.env.NEXT_PUBLIC_APPLE_CLIENT_ID || '',
          redirectURI: `${API_BASE_URL}/api/auth/apple`,
          scopes: 'email name',
        });
        
        const fullName = response.givenName ? `${response.givenName} ${response.familyName}` : undefined;
        if (response.identityToken) {
           await authenticateAppleWithServer(response.identityToken, fullName);
        }
      } else {
        // We pass the current URL origin in the "state" variable so the backend knows exactly where to send us back!
        const currentOrigin = window.location.origin;
        const appleAuthUrl = `https://appleid.apple.com/auth/authorize?client_id=${process.env.NEXT_PUBLIC_APPLE_CLIENT_ID}&redirect_uri=${API_BASE_URL}/api/auth/apple&response_type=code%20id_token&scope=name%20email&response_mode=form_post&state=${encodeURIComponent(currentOrigin)}`;
        
        // Redirect the current tab entirely.
        window.location.href = appleAuthUrl;
      }
    } catch (error) {
      console.error("Apple Login Error: ", error);
    }
  };

  // The handleLogout function handles user logout for both native and web platforms. It signs the user out of Google if on a native platform,
  const handleLogout = async () => {
    if (isNative) {
      try { await GoogleAuth.signOut(); } catch (e) {}
    } else {
      googleLogout();
    }
    
    // Non-blocking telemetry wipe
    import('posthog-js').then(({ default: ph }) => {
        ph.reset();
    }).catch(() => console.warn("Analytics blocked by browser"));

    // Remove the authentication token and user information from localStorage
    localStorage.removeItem('glide_token');
    localStorage.removeItem('glide_user');

    setUser(null);
    window.location.reload();
  };

  // The component renders different UI elements based on the user's authentication state. If the user is authenticated, 
  // it displays their profile picture and name with a logout button. If not, it shows a "Sign In" button that opens a 
  // modal with sign-in options for Google and Apple.
  if (!mounted) {
    return <div className="w-[100px] h-[36px] opacity-0"></div>;
  }
  
  // If the user is authenticated, we display their profile picture and first name, along with a logout button.
  if (user) {
    return (
      <div className="flex items-center space-x-3 bg-white dark:bg-white/10 rounded-full pr-4 p-1 backdrop-blur-md border border-gray-200 dark:border-white/20 shadow-sm dark:shadow-lg">
        <Link href="/profile" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
          <img 
              src={user.picture} 
              alt="Profile" 
              className="w-8 h-8 rounded-full border border-gray-200 dark:border-white/50 object-cover" 
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

  // If the user is not authenticated, we display a "Sign In" button that opens a modal with sign-in options for Google and Apple.
  // The modal includes buttons for Google and Apple sign-in, and it conditionally renders the Apple sign-in button only on Apple devices.
  // The modal also includes a close button and links to the Privacy Policy and Terms of Service.
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

            <div className="space-y-4 w-full flex flex-col items-center">
              
              {isNative ? (
                /* Native Google Button matched exactly to h-10 */
                <button 
                  onClick={handleNativeLogin} 
                  className="flex items-center justify-center w-[320px] h-10 px-4 rounded-full border border-gray-700 bg-transparent hover:bg-white/5 text-white text-sm font-medium transition-colors active:scale-[0.98]"
                >
                  <svg className="w-4 h-4 mr-3" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </button>
              ) : (
                /* Web Google wrapper matching standard 40px layout */
                <div className="shadow-lg rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 w-[320px] h-10">
                  <GoogleLogin
                    onSuccess={handleWebLoginSuccess}
                    onError={() => console.error('Google Web Form Error: Login Failed')}
                    theme={resolvedTheme === 'dark' ? 'filled_black' : 'outline'}
                    shape="pill"
                    width="320"
                    text="continue_with"
                    useOneTap={false} 
                    use_fedcm_for_prompt={true} 
                  />
                </div>
              )}

              {/* Apple Button adjusted to match standard h-10 (40px) height perfectly */}
              {isAppleDevice && (
                <button 
                  onClick={handleAppleLogin} 
                  className="flex items-center justify-center w-[320px] h-10 px-4 rounded-full border border-gray-700 bg-transparent hover:bg-white/5 text-white text-sm font-medium transition-colors active:scale-[0.98]"
                >
                  <svg className="w-4 h-4 mr-2.5 mb-0.5 fill-white" viewBox="0 0 24 24">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.17 2.24-.86 3.44-.8 1.48.05 2.75.69 3.48 1.83-3.13 1.76-2.58 5.76.28 6.84-.71 1.85-1.74 3.54-2.28 4.3zm-3.51-14.8c-.89.1-1.85-.4-2.5-1.15-.65-.79-.98-1.92-.81-2.92.93-.07 1.94.43 2.58 1.18.67.78.96 1.81.73 2.89z" />
                  </svg>
                  Continue with Apple
                </button>
              )}

            </div>

            <p className="text-xs text-gray-500 mt-8 text-center">
              By continuing you agree to our <Link href="/privacy" className="text-gray-400 hover:text-white transition-colors underline decoration-gray-600 underline-offset-2">Privacy Policy</Link> and <Link href="/terms" className="text-gray-400 hover:text-white transition-colors underline decoration-gray-600 underline-offset-2">Terms of Service</Link>.
            </p>

          </div>
        </div>
      )}
    </>
  );
}
