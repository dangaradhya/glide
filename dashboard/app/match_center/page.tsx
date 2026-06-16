// app/live_updates/page.tsx
"use html";
"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import AuthButton from '@/components/AuthButton';

// Added specific destination URLs and visual gradient colors for each league
interface League {
  id: string;
  name: string;
  category: string;
  url: string;
  color: string;
}

// List of popular leagues with their official live score URLs and custom gradient colors for the dashboard cards
const AVAILABLE_LEAGUES: League[] = [
  { id: 'nba', name: 'NBA', category: 'Basketball', url: 'https://www.espn.com/nba/scoreboard', color: 'from-orange-400 to-red-500' },
  { id: 'mlb', name: 'MLB', category: 'Baseball', url: 'https://www.espn.com/mlb/scoreboard', color: 'from-blue-600 to-blue-900' },
  { id: 'nfl', name: 'NFL', category: 'American Football', url: 'https://www.espn.com/nfl/scoreboard', color: 'from-sky-500 to-indigo-600' },
  { id: 'nhl', name: 'NHL', category: 'Hockey', url: 'https://www.espn.com/nhl/scoreboard', color: 'from-cyan-400 to-blue-600' },
  { id: 'cricket', name: 'Intl Cricket', category: 'Cricket', url: 'https://www.espncricinfo.com/live-cricket-match-results', color: 'from-emerald-400 to-teal-600' },
  { id: 'atp', name: "Tennis", category: 'Tennis', url: 'https://www.sofascore.com/tennis', color: 'from-lime-400 to-green-600' },
  { id: 'ufc', name: 'UFC', category: 'MMA', url: 'https://www.espn.com/mma/schedule', color: 'from-red-600 to-red-900' },
  { id: 'f1', name: 'Formula 1', category: 'Motorsport', url: 'https://www.formula1.com/en/racing/2026.html', color: 'from-red-500 to-rose-700' },
  { id: 'premier_league', name: 'Premier League', category: 'Football', url: 'https://www.fotmob.com/leagues/47/overview/premier-league', color: 'from-purple-500 to-indigo-600' },
  { id: 'serie_a', name: 'Serie A', category: 'Football', url: 'https://www.fotmob.com/leagues/55/overview/serie-a', color: 'from-blue-500 to-blue-800' },
  { id: 'la_liga', name: 'La Liga', category: 'Football', url: 'https://www.fotmob.com/leagues/87/overview/la-liga', color: 'from-orange-400 to-red-600' },
  { id: 'bundesliga', name: 'Bundesliga', category: 'Football', url: 'https://www.fotmob.com/leagues/54/overview/bundesliga', color: 'from-red-500 to-neutral-800' },
  { id: 'ligue_1', name: 'Ligue 1', category: 'Football', url: 'https://www.fotmob.com/leagues/53/overview/ligue-1', color: 'from-yellow-400 to-yellow-600' },
  { id: 'champions_league', name: 'UEFA Champions League', category: 'Football', url: 'https://www.fotmob.com/leagues/42/overview/champions-league', color: 'from-indigo-800 to-blue-900' },
  { id: 'europa_league', name: 'UEFA Europa League', category: 'Football', url: 'https://www.fotmob.com/leagues/73/overview/europa-league', color: 'from-orange-500 to-yellow-600' },
  { id: 'conference_league', name: 'UEFA Conference League', category: 'Football', url: 'https://www.fotmob.com/leagues/10216/overview/uefa-conference-league', color: 'from-green-500 to-teal-700' },
  { id: 'world_cup', name: 'FIFA World Cup', category: 'Intl Football', url: 'https://www.fotmob.com/leagues/77/overview/world-cup', color: 'from-amber-600 to-red-700' },
  { id: 'euros', name: 'Euros', category: 'Intl Football', url: 'https://www.fotmob.com/leagues/50/overview/euro', color: 'from-blue-600 to-indigo-800' },
  { id: 'copa_america', name: 'Copa America', category: 'Intl Football', url: 'https://www.fotmob.com/leagues/130/overview/copa-america', color: 'from-sky-400 to-blue-700' },
  { id: 'nations_league', name: 'UEFA Nations League', category: 'Intl Football', url: 'https://www.fotmob.com/leagues/9806/overview/uefa-nations-league', color: 'from-slate-600 to-slate-900' },
];

// The main Match Center component that allows users to select their favorite leagues and provides quick access to official live score pages
export default function LiveUpdatesPage() {
  // 1. STATE MANAGEMENT
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [preferences, setPreferences] = useState<string[]>([]);
  const [isEditingPreferences, setIsEditingPreferences] = useState<boolean>(false);
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);
  const [preferencesLoading, setPreferencesLoading] = useState<boolean>(true);

  // 2. EFFECT TO CHECK AUTHENTICATION AND FETCH PREFERENCES
  useEffect(() => {
    const token = localStorage.getItem('glide_token');
    
    // If no token is found, the user is not authenticated, so we can skip fetching preferences
    if (!token) {
      setIsAuthenticated(false);
      setPreferencesLoading(false);
      return;
    }
    
    setIsAuthenticated(true);

    // Fetch user preferences to determine which leagues they have selected
    fetch('http://localhost:3000/api/users/me/preferences', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.preferences && data.preferences.length > 0) {
          setPreferences(data.preferences);
          setSelectedLeagues(data.preferences); 
        } else {
          setIsEditingPreferences(true);
        }
        setPreferencesLoading(false);
      })
      .catch(err => {
        console.error("Error fetching preferences:", err);
        setPreferencesLoading(false);
      });
  }, []);

  // 3. HANDLERS FOR TOGGLING LEAGUE SELECTION AND SAVING PREFERENCES
  const toggleLeagueSelection = (leagueId: string) => {
    setSelectedLeagues(prev => 
      prev.includes(leagueId) ? prev.filter(id => id !== leagueId) : [...prev, leagueId]
    );
  };

  const savePreferences = async () => {
    const token = localStorage.getItem('glide_token');
    if (!token) return;

    // Save the selected leagues to the backend and update the local state
    try {
      const res = await fetch('http://localhost:3000/api/users/me/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ leagues: selectedLeagues })
      });

      if (res.ok) {
        setPreferences(selectedLeagues);
        setIsEditingPreferences(false);
      }
    } catch (err) {
      console.error("Failed to save preferences:", err);
    }
  };

  // Helper to get full league object from string ID
  const activeLeagueData = preferences
    .map(id => AVAILABLE_LEAGUES.find(l => l.id === id))
    .filter(Boolean) as League[];

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 relative transition-colors duration-300">
      <div className="max-w-4xl mx-auto">
        
        {/* Header Section */}
        <div className="flex items-center justify-between mb-4"> 
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            Glide
          </h1>
          
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>

        {/* Navigation Section */}
        <div className="flex justify-center space-x-8 mb-8">
          <Link href="/" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
            Posts
          </Link>
          <Link href="/reels" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
            Reels
          </Link>
          <span className="text-gray-900 dark:text-white font-bold text-lg border-b-2 border-purple-500 pb-1 cursor-default">
            Match Center
          </span>
        </div>

        {/* Main Content Area - Conditional rendering based on authentication and preferences state */}
        {(isAuthenticated === null || preferencesLoading) ? (
          <div className="flex justify-center items-center h-64">
             <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : 

        isAuthenticated === false ? (
          <div className="flex flex-col items-center justify-center bg-white dark:bg-gray-900 rounded-xl p-10 border border-gray-200 dark:border-gray-800 shadow-md text-center space-y-6 mt-10">
            <div className="p-4 bg-purple-100 dark:bg-purple-900/20 rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-3xl font-bold mb-2">Match Center Portal</h2>
              <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                Sign in to customize your dashboard with official real-time scores, schedules, and standings.
              </p>
            </div>
          </div>
        ) : 

        isEditingPreferences ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-md animate-in fade-in zoom-in duration-300">
            <div className="mb-6 border-b border-gray-100 dark:border-gray-800 pb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Build Your Dashboard</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Select the leagues you want to track. Glide will redirect you to official live coverage.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {AVAILABLE_LEAGUES.map((league) => {
                const isSelected = selectedLeagues.includes(league.id);
                return (
                  <div 
                    key={league.id}
                    onClick={() => toggleLeagueSelection(league.id)}
                    className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center justify-center text-center space-y-2 transition-all duration-200 ${
                      isSelected 
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/10 shadow-sm ring-1 ring-purple-500' 
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="absolute top-2 right-2">
                      {isSelected && (
                        <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{league.category}</span>
                    <span className={`text-sm font-semibold ${isSelected ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-200'}`}>
                      {league.name}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end space-x-4 border-t border-gray-100 dark:border-gray-800 pt-4">
              {preferences.length > 0 && (
                <button 
                  onClick={() => {
                    setSelectedLeagues(preferences); 
                    setIsEditingPreferences(false);
                  }}
                  className="px-6 py-2 rounded-lg font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button 
                onClick={savePreferences}
                disabled={selectedLeagues.length === 0}
                className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold rounded-lg hover:shadow-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Save Launchpad
              </button>
            </div>
          </div>
        ) : 

        (
        <div className="w-full flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-md dark:shadow-lg transition-all duration-300">
          
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-900">
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
              Your Match Center
            </h2>
            <button 
              onClick={() => setIsEditingPreferences(true)}
              className="text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-md transition-colors"
            >
              ⚙️ Manage Dashboard
            </button>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-gray-50 dark:bg-gray-950/40">
            {activeLeagueData.map(league => (
              <a 
                key={league.id}
                href={league.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative overflow-hidden rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
              >
                {/* Dynamic Gradient Background based on League colors */}
                <div className={`absolute inset-0 bg-gradient-to-br ${league.color} opacity-90 group-hover:opacity-100 transition-opacity`}></div>
                
                <div className="relative p-6 h-full flex flex-col justify-between min-h-[140px]">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-white/80 font-bold mb-1 block">
                      {league.category}
                    </span>
                    <h3 className="text-xl font-bold text-white leading-tight">
                      {league.name}
                    </h3>
                  </div>
                  
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm font-medium text-white/90 bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm">
                      Live Updates &rarr;
                    </span>
                    <svg className="w-5 h-5 text-white transform group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
        )}
      </div>
    </main>
  );
}