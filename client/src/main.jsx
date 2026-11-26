import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthPage, AuthProvider, useAuth } from './auth.jsx';
import { Compare } from './compare.jsx';
import { Loading } from './components.jsx';
import { Interview, Interviews } from './interviews.jsx';
import { Jobs, Resumes } from './library.jsx';
import { Settings } from './settings.jsx';
import { Overview, Workspace } from './workspace.jsx';
import './styles.css';

function ProtectedWorkspace() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  if (user === undefined) return <main className="fullscreen-loading"><Loading text="Opening Resume Studio…" /></main>;
  if (!user) return <Navigate to="/sign-in" state={{ from: pathname + search }} replace />;
  return <Workspace />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<AuthPage />} />
          <Route element={<ProtectedWorkspace />}>
            <Route index element={<Overview />} />
            <Route path="resumes" element={<Resumes />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="compare" element={<Compare />} />
            <Route path="interviews" element={<Interviews />} />
            <Route path="interviews/:id" element={<Interview />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
