import { useState } from 'react';
import { ArrowRight, Check, ChevronDown, FileSearch, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { messageFrom } from './api.js';

export function PageHeading({ title, description, children }) {
  return <header className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</header>;
}

export function Notice({ children, tone = 'error' }) {
  return children ? <p className={'notice ' + tone} role={tone === 'error' ? 'alert' : 'status'}>{children}</p> : null;
}

export function Loading({ text = 'Loading…' }) {
  return <div className="loading" role="status"><LoaderCircle size={21} className="spin" /> {text}</div>;
}

export function Empty({ icon: Icon = FileSearch, title, detail, to, action }) {
  return <div className="empty"><div className="icon-tile"><Icon size={23} /></div>
    <h3>{title}</h3><p>{detail}</p>
    {to && <Link to={to} className="button secondary">{action}<ArrowRight size={16} /></Link>}
  </div>;
}

export function Chip({ children, tone, check = false }) {
  return <span className={'chip' + (tone ? ' chip-' + tone : '')}>{check && <Check size={13} />}{children}</span>;
}

export function DateLabel({ value }) {
  if (!value) return null;
  const date = new Date(value);
  return <time dateTime={date.toISOString()}>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time>;
}

export function Source({ source }) {
  return <Chip tone={source === 'gemini' ? 'green' : undefined}>{source === 'gemini' ? 'Gemini assisted' : 'Local rules'}</Chip>;
}

export function useTask() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function run(task) {
    setPending(true);
    setError('');
    try {
      await task();
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}

export function PairFields({ resumes, jobs, initial = {} }) {
  return <div className="form-grid">
    <label>Resume<span className="select-wrap"><select name="resumeId" defaultValue={initial.resumeId || ''} required>
      <option value="" disabled>Choose a resume</option>
      {resumes.map((resume) => <option key={resume._id} value={resume._id}>{resume.fileName}</option>)}
    </select><ChevronDown size={16} /></span></label>
    <label>Job description<span className="select-wrap"><select name="jdId" defaultValue={initial.jdId || ''} required>
      <option value="" disabled>Choose a job</option>
      {jobs.map((job) => <option key={job._id} value={job._id}>{job.title}{job.company ? ' · ' + job.company : ''}</option>)}
    </select><ChevronDown size={16} /></span></label>
  </div>;
}

export function ResourcePrompt({ resumes, jobs }) {
  return <div className="resource-prompt">
    <p>Add a resume and a job description to continue.</p>
    {!resumes.length && <Link to="/resumes" className="button secondary">Upload resume<ArrowRight size={15} /></Link>}
    {!jobs.length && <Link to="/jobs" className="button secondary">Add job description<ArrowRight size={15} /></Link>}
  </div>;
}
