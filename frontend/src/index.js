import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import DexaUploader from './DexaUploader';
import CasesCanvas from './canvas/CasesCanvas';
import LoginPage from './auth/LoginPage';
import Visualization from './Visualization';
import { supabase } from './auth/supabaseClient';
import './index.css';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('upload');
  const [, setVizFilename] = useState(null);
  const [casesRefreshKey, setCasesRefreshKey] = useState(0);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes (login, logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  function handleUploadComplete() {
    setCasesRefreshKey(prev => prev + 1);
  }

  if (loading) return null;

  if (!session) return <LoginPage />;

  const displayName = session.user?.user_metadata?.display_name || session.user?.email;

  return (
    <div className="app-shell">
      <div className="top-bar">
        <span className="welcome-msg">Welcome, {displayName}</span>
        <nav className="app-nav">
          <button
            className={view === 'upload' ? 'active' : ''}
            onClick={() => setView('upload')}
          >
            New Upload
          </button>
          <button
            className={view === 'cases' ? 'active' : ''}
            onClick={() => {
              setCasesRefreshKey(prev => prev + 1);
              setView('cases');
            }}
          >
            My Cases
          </button>
          <button
            className={view === 'visualization' ? 'active' : ''}
            onClick={() => setView('visualization')}
          >
            Visualize Data
          </button>
        </nav>
        <button onClick={() => supabase.auth.signOut()} className="logout-btn">
          Sign Out
        </button>
      </div>

      {view === 'visualization' ? (
        <Visualization session={session} />
      ) : view === 'upload' ? (
        <DexaUploader
          session={session}
          onUploadComplete={handleUploadComplete}
          onVisualize={() => setView('visualization')}
        />
      ) : (
        <CasesCanvas
          session={session}
          refreshKey={casesRefreshKey}
        />
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
