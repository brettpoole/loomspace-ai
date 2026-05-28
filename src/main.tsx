import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AuthGate from './AuthGate';
import { hasAuthToken, clearAuthToken, apiGetMe, type AuthUser } from './lib/api';
import { clearLocalData } from './lib/store';
import './styles.css';
import './styles-media.css';

function Root() {
  // null  = not yet resolved
  // false = no token / token invalid
  // AuthUser = authenticated
  const [user, setUser] = useState<AuthUser | null | false>(null);

  useEffect(() => {
    if (!hasAuthToken()) {
      setUser(false);
      return;
    }
    // Validate the stored token and get the user ID.
    apiGetMe()
      .then((u) => setUser(u))
      .catch(() => {
        // Token expired or invalid — clear it and show login.
        clearAuthToken();
        setUser(false);
      });
  }, []);

  function handleAuth(u: AuthUser) {
    setUser(u);
  }

  function handleLogout() {
    clearLocalData();
    clearAuthToken();
    setUser(false);
  }

  // Still resolving
  if (user === null) return null;

  if (user === false) {
    return <AuthGate onAuth={handleAuth} />;
  }

  return <App userId={user.id} onLogout={handleLogout} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
