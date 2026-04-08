// src/pages/AuthPage.tsx
import { useState } from 'react';
import { login, register } from '../api';
import styles from './AuthPage.module.css';

interface Props { onAuth: () => void; }

export default function AuthPage({ onAuth }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const reset = (next: 'login' | 'register') => {
    setMode(next); setError(''); setEmail(''); setPassword(''); setConfirm('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (password !== confirm) { setError('Parolele nu se potrivesc.'); return; }
      if (password.length < 8)  { setError('Parola trebuie să aibă cel puțin 8 caractere.'); return; }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({ email, password });
      }
      onAuth();
    } catch (err: any) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Brand */}
        <div className={styles.brand}>
          <span className={styles.brandMark}>◆</span>
          <span className={styles.brandName}>Evidența stocurilor</span>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
            onClick={() => reset('login')}
          >
            Autentificare
          </button>
          <button
            className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`}
            onClick={() => reset('register')}
          >
            Cont nou
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="adresa@exemplu.com"
              autoComplete="email"
              autoFocus
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Parolă</label>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Minimum 8 caractere' : '••••••••'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          {mode === 'register' && (
            <div className={styles.field}>
              <label className={styles.label}>Confirmă parola</label>
              <input
                className={styles.input}
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repetă parola"
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'Intră în cont' : 'Creează cont'}
          </button>
        </form>

        <p className={styles.switchHint}>
          {mode === 'login' ? 'Nu ai cont?' : 'Ai deja cont?'}{' '}
          <button
            className={styles.switchLink}
            onClick={() => reset(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Înregistrează-te' : 'Autentifică-te'}
          </button>
        </p>
      </div>
    </div>
  );
}
