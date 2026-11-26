import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowRight, ChartNoAxesCombined, Check, FileText, Layers3, MessageCircle, MoveUpRight } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, messageFrom } from './api.js';

const Auth = createContext(null);
export const useAuth = () => useContext(Auth);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    const controller = new AbortController();
    api.get('/auth/me', { signal: controller.signal }).then(({ data }) => setUser(data)).catch(() => {
      if (!controller.signal.aborted) setUser(null);
    });
    const interceptor = api.interceptors.response.use((response) => response, (error) => {
      if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/')) setUser(null);
      return Promise.reject(error);
    });
    return () => {
      controller.abort();
      api.interceptors.response.eject(interceptor);
    };
  }, []);
  return <Auth.Provider value={{ user, setUser }}>{children}</Auth.Provider>;
}

export function Brand({ light = false }) {
  return <div className={'brand' + (light ? ' brand-light' : '')}>
    <span className="brand-icon"><Layers3 size={20} strokeWidth={2.2} /></span>
    <span>Resume Studio<span className="brand-subtitle">Career workspace</span></span>
  </div>;
}

export function AuthPage() {
  const { user, setUser } = useAuth();
  const location = useLocation();
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  async function submit(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post(register ? '/auth/register' : '/auth/login', form);
      setUser(data);
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-layout">
    <section className="auth-story">
      <Brand light />
      <div className="auth-story-body">
        <span className="auth-kicker"><span /> Job search toolkit</span>
        <h1>Walk into your next interview prepared.</h1>
        <p>See where your experience fits a role, then practice the questions you’re most likely to face.</p>
        <div className="sample-card">
          <div className="sample-heading"><span className="sample-icon"><ChartNoAxesCombined size={22} /></span>
            <div><strong>Backend Engineer</strong><small>Sample fit report</small></div>
            <MoveUpRight size={18} className="sample-arrow" aria-hidden="true" />
          </div>
          <div className="sample-score"><strong>78<span>/100</span></strong><span className="sample-label">Job fit</span></div>
          <div className="sample-progress"><span /></div>
          <div className="sample-skills"><span><Check size={14} /> Node.js</span><span><Check size={14} /> MongoDB</span><span className="sample-gap">Practice Redis</span></div>
        </div>
        <div className="auth-features"><span><FileText size={17} /> Resume analysis</span><span><MessageCircle size={17} /> Interview practice</span></div>
      </div>
    </section>
    <section className="auth-form-side">
      <div className="auth-form-box">
        <h2>{register ? 'Create your account' : 'Welcome back'}</h2>
        <p className="muted">{register ? 'Set up your personal workspace to get started.' : 'Sign in to continue preparing for your next role.'}</p>
        <form className="stack auth-form" onSubmit={submit}>
          {register && <label>Full name<input name="name" autoComplete="name" placeholder="Alex Morgan" minLength={2} maxLength={80} required /></label>}
          <label>Email<input type="email" name="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required /></label>
          <label>Password<input type="password" name="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'At least 8 characters' : 'Enter your password'} minLength={register ? 8 : 1} maxLength={72} required /></label>
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="button primary wide" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></button>
        </form>
        <p className="auth-switch">{register ? 'Already have an account?' : 'New to Resume Studio?'}{' '}
          <button type="button" className="text-button" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>
            {register ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </div>
    </section>
  </main>;
}
