import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import './LoginPage.css';

export default function LoginPage() {
  const [tab, setTab] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const resetState = () => {
    setError('');
    setSuccessMsg('');
    setName('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    resetState();

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
    }
    setLoading(false);
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    resetState();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });

    if (error) {
      setError(error.message);
    } else {
      setSuccessMsg('Account created! Check your email to confirm your account.');
      setEmail('');
      setPassword('');
      setName('');
    }
    setLoading(false);
  };

  const switchTab = (newTab) => {
    setTab(newTab);
    resetState();
    setEmail('');
    setPassword('');
    setName('');
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <h1>WashU Medicine</h1>
          <p>DEXA Scan Data Portal</p>
        </div>

        <div className="login-tabs">
          <button
            className={tab === 'login' ? 'active' : ''}
            onClick={() => switchTab('login')}
          >
            Sign In
          </button>
          <button
            className={tab === 'signup' ? 'active' : ''}
            onClick={() => switchTab('signup')}
          >
            Sign Up
          </button>
        </div>

        {error && <div className="error-msg">{error}</div>}
        {successMsg && <div className="success-msg">{successMsg}</div>}

        <form onSubmit={tab === 'login' ? handleLogin : handleSignUp}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@wustl.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {tab === 'signup' && (
            <div className="form-group">
              <label htmlFor="name">Full Name</label>
              <input
                id="name"
                type="text"
                placeholder="Jane Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading
              ? 'Please wait...'
              : tab === 'login'
              ? 'Sign In'
              : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
