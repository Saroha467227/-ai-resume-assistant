import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, ChartNoAxesCombined, ChevronRight, CircleHelp, FileText, LayoutDashboard, LogOut, Menu, MessageCircle, Settings, X } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { api, messageFrom } from './api.js';
import { Brand, useAuth } from './auth.jsx';
import { DateLabel, Empty, Loading, Notice, PageHeading } from './components.jsx';

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/resumes', label: 'Resumes', icon: FileText },
  { to: '/jobs', label: 'Job descriptions', icon: BriefcaseBusiness },
  { to: '/compare', label: 'Fit analysis', icon: ChartNoAxesCombined },
  { to: '/interviews', label: 'Interviews', icon: MessageCircle },
  { to: '/settings', label: 'Settings', icon: Settings }
];
export const useWorkspace = () => useOutletContext();

const paths = { resumes: '/resumes', jobs: '/job-descriptions', reports: '/analyses', interviews: '/interviews' };
const pageSize = 20;
const emptyLibrary = { resumes: [], jobs: [], reports: [], interviews: [] };

export function Workspace() {
  const { user, setUser } = useAuth();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const [sections, setSections] = useState({});
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const requestVersion = useRef(0);
  const overview = location.pathname === '/';

  const loadSection = useCallback(async (key, { signal, offset = 0, version = requestVersion.current } = {}) => {
    setSections((current) => ({ ...current, [key]: { ...current[key], pending: true, error: '' } }));
    try {
      const paginated = overview || key === 'reports' || key === 'interviews';
      const { data, headers } = await api.get(paths[key], {
        signal,
        params: paginated ? { limit: overview ? 5 : pageSize, offset } : undefined
      });
      if (signal?.aborted || version !== requestVersion.current) return;
      setSections((current) => {
        const rows = offset ? [...(current[key]?.rows || []), ...data] : data;
        return { ...current, [key]: {
          rows: [...new Map(rows.map((row) => [row._id, row])).values()],
          offset: offset + data.length,
          total: Number(headers['x-total-count'] ?? rows.length),
          best: headers['x-best-score'] === undefined ? null : Number(headers['x-best-score']),
          pending: false
        } };
      });
    } catch (err) {
      if (signal?.aborted || version !== requestVersion.current) return;
      setSections((current) => ({ ...current, [key]: { ...current[key], pending: false, error: messageFrom(err) } }));
    }
  }, [overview]);

  const refresh = useCallback(async (signal) => {
    const version = ++requestVersion.current;
    await Promise.all(Object.keys(paths).map((key) => loadSection(key, { signal, version })));
  }, [loadSection]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const library = Object.fromEntries(Object.entries(emptyLibrary)
    .map(([key, rows]) => [key, sections[key]?.rows || rows]));

  async function logout() {
    setLoggingOut(true);
    try {
      await api.post('/auth/logout');
      setUser(null);
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setLoggingOut(false);
    }
  }

  const current = navigation.find(({ to }) => to === location.pathname)
    || navigation.find(({ to }) => to !== '/' && location.pathname.startsWith(to + '/')) || navigation[0];
  const initials = user.name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
  return <div className="workspace">
    {menu && <button className="nav-overlay" type="button" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <aside id="navigation" className={'sidebar' + (menu ? ' sidebar-open' : '')}>
      <div className="sidebar-brand"><Link to="/" onClick={() => setMenu(false)}><Brand /></Link>
        <button type="button" className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMenu(false)}><X size={20} /></button>
      </div>
      <nav aria-label="Workspace" className="sidebar-nav">
        {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenu(false)}>
          <Icon size={19} strokeWidth={1.8} />{label}
        </NavLink>)}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-account"><span className="avatar">{initials}</span><div><strong>{user.name}</strong><small>{user.targetRole || 'Personal workspace'}</small></div>
          <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" disabled={loggingOut} onClick={logout}><LogOut size={17} /></button>
        </div>
      </div>
    </aside>
    <div className="workspace-main">
      <header className="topbar">
        <button type="button" className="icon-button mobile-menu" aria-controls="navigation" aria-expanded={menu} aria-label="Open navigation" onClick={() => setMenu(true)}><Menu size={22} /></button>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={15} /><strong>{current.label}</strong></div>
        <Link to="/settings" className="topbar-avatar" aria-label="Profile settings"><span className="avatar">{initials}</span></Link>
      </header>
      <main className="content">
        <Notice>{error}</Notice>
        {Object.entries(sections).filter(([, section]) => section.error).map(([key, section]) =>
          <div key={key}><Notice>{key + ': ' + section.error}</Notice>
            <button type="button" className="button secondary" onClick={() => loadSection(key)}>Retry {key}</button>
          </div>)}
        <Outlet context={{
          ...library, sections, refresh,
          loadMore: (key) => loadSection(key, { offset: sections[key]?.offset || 0 })
        }} />
      </main>
    </div>
  </div>;
}

const steps = [
  { icon: FileText, title: 'Upload a resume', description: 'Extract skills and experience from a PDF or DOCX.', to: '/resumes', text: 'Go to resumes' },
  { icon: BriefcaseBusiness, title: 'Add a target job', description: 'Save a job description and see its requirements.', to: '/jobs', text: 'Go to job descriptions' },
  { icon: ChartNoAxesCombined, title: 'Compare and practice', description: 'Find your strongest matches and work on gaps.', to: '/compare', text: 'Open fit analysis' }
];

export function Overview() {
  const { user } = useAuth();
  const { jobs, reports, interviews, sections } = useWorkspace();
  const bestScore = sections.reports?.best ?? null;
  const activities = [
    ...reports.map((report) => ({
      id: report._id, date: report.updatedAt, type: 'Fit report', icon: ChartNoAxesCombined,
      detail: report.score === null ? 'No scored requirements' : report.score + '/100',
      title: report.jobTitle || jobs.find((job) => job._id === report.jdId)?.title || 'Fit analysis',
      to: '/compare?report=' + report._id
    })),
    ...interviews.map((interview) => ({
      id: interview._id, date: interview.updatedAt, type: 'Interview', icon: MessageCircle,
      detail: interview.status === 'complete' ? interview.summary.score + '/5' : 'In progress',
      title: interview.jobTitle || jobs.find((job) => job._id === interview.jdId)?.title || 'Practice session',
      to: '/interviews/' + interview._id
    }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return <>
    <PageHeading title={'Welcome, ' + user.name.split(/\s+/)[0]} description="Manage your resumes, track job fit, and prepare for interviews.">
      <Link to="/resumes" className="button primary"><FileText size={17} /> Upload resume</Link>
    </PageHeading>
    <div className="overview-banner">
      <div><h2>Prepare for a specific role</h2><p>Compare a resume with a job description, then turn the gaps into practice questions.</p>
        <Link to="/compare" className="button banner-button">Compare resume and job<ArrowRight size={17} /></Link>
      </div>
      <div className="banner-illustration" aria-hidden="true"><div className="banner-outline first" /><div className="banner-outline second" /><div className="banner-outline third" /><div className="banner-symbol"><ChartNoAxesCombined size={43} strokeWidth={1.4} /></div></div>
    </div>
    <div className="stat-grid">
      {[
        { icon: FileText, label: 'Resumes', value: sections.resumes?.total ?? '—', to: '/resumes' },
        { icon: BriefcaseBusiness, label: 'Job descriptions', value: sections.jobs?.total ?? '—', to: '/jobs' },
        { icon: ChartNoAxesCombined, label: 'Best fit score', value: bestScore === null ? '—' : bestScore + '%', to: '/compare' },
        { icon: MessageCircle, label: 'Interviews', value: sections.interviews?.total ?? '—', to: '/interviews' }
      ].map(({ icon: Icon, label, value, to }) => <Link key={label} className="stat-card" to={to}>
        <span className="icon-tile"><Icon size={19} /></span><ChevronRight size={16} className="stat-arrow" />
        <strong>{value}</strong><span>{label}</span>
      </Link>)}
    </div>
    <div className="overview-grid">
      <section className="panel">
        <h2>Get started</h2>
        <div className="step-list">{steps.map(({ icon: Icon, title, description, to, text }) =>
          <Link className="step" to={to} key={to}><span className="icon-tile"><Icon size={19} /></span>
            <div><strong>{title}</strong><p>{description}</p><span className="step-action">{text}</span></div><ChevronRight size={17} />
          </Link>)}</div>
      </section>
      <section className="panel">
        <h2>Recent activity</h2>
        {activities.length ? <div className="list">{activities.map(({ id, icon: Icon, date, type, detail, title, to }) => <Link className="list-row" key={id} to={to}>
          <span className="icon-tile"><Icon size={18} /></span><span className="list-title"><strong>{title}</strong><small>{type} · <DateLabel value={date} /></small></span><span className="list-meta">{detail}</span>
        </Link>)}</div> : sections.reports?.pending || sections.interviews?.pending ? <Loading /> : <Empty icon={CircleHelp} title="Activity will appear here" detail="Run a fit analysis or start a practice interview to see it here." />}
      </section>
    </div>
  </>;
}

export function HistoryPagination({ section }) {
  const { sections, loadMore } = useWorkspace();
  const page = sections[section];
  if (!page?.rows) return page?.pending ? <Loading /> : null;
  if (page.offset >= page.total) return null;
  return <button type="button" className="button secondary" disabled={page.pending}
    onClick={() => loadMore(section)}>{page.pending ? 'Loading…' : 'Load more'}</button>;
}
