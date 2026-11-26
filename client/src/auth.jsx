import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowRight, FileText, Layers3 } from 'lucide-react';
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

function SampleFitReport() {
  return <aside className="auth-example" aria-label="Sample fit report">
    <div className="sample-paper">
      <p className="sample-caption"><FileText size={16} aria-hidden="true" />Sample fit report</p>
      <div className="sample-title">
        <h2>Backend Engineer</h2>
        <div className="sample-score"><span>Job fit</span><strong>78<small>/100</small></strong></div>
      </div>
      <dl className="sample-evidence">
        <dt>Matched skills</dt><dd>Node.js, MongoDB</dd>
      </dl>
      <div className="sample-note">
        <h3>Skill to review</h3>
        <p>Redis appears in the job description. Your résumé doesn’t mention it.</p>
      </div>
    </div>
  </aside>;
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
    <header className="auth-brand"><Brand /></header>
    <section className="auth-form-side">
      <div className="auth-form-box">
        <h1>{register ? 'Create your account' : 'Sign in to Resume Studio'}</h1>
        <p className="muted">{register ? 'Compare your résumé with a job and practice interview questions about the role.' : 'Open your fit reports and pick up your interview practice.'}</p>
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
    <SampleFitReport />
  </main>;
}
