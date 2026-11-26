import { useRef, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, CloudUpload, FileText, Plus, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from './api.js';
import { Chip, DateLabel, Empty, Notice, PageHeading, Source, useTask } from './components.jsx';
import { useWorkspace } from './workspace.jsx';

const maxResumeMb = import.meta.env.MODE === 'vercel' ? 4 : 5;

export function Resumes() {
  const { resumes, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  const selected = resumes.find((item) => item._id === params.get('resume'));
  const task = useTask();

  function choose(candidate) {
    setValidation('');
    if (!candidate) return;
    if (!/\.(pdf|docx)$/i.test(candidate.name) || candidate.size > maxResumeMb * 1024 * 1024) {
      setFile(null);
      if (input.current) input.current.value = '';
      setValidation('Choose a PDF or DOCX file of ' + maxResumeMb + ' MB or less.');
      return;
    }
    setFile(candidate);
  }

  function upload(event) {
    event.preventDefault();
    if (!file) return;
    const data = new FormData();
    data.set('resume', file);
    task.run(async () => {
      const { data: resume } = await api.post('/resumes', data);
      await refresh();
      setFile(null);
      input.current.value = '';
      setParams({ resume: resume._id });
    });
  }

  function remove() {
    if (!window.confirm('Delete this resume and its fit reports and interviews?')) return;
    task.run(async () => {
      await api.delete('/resumes/' + selected._id);
      await refresh();
      setParams({});
    });
  }

  return <>
    <PageHeading title="Resumes" description="Upload a resume and review the skills and experience extracted from it." />
    <div className="library-grid">
      <section className="panel">
        <h2>Upload a resume</h2>
        <form className="stack" onSubmit={upload}>
          <label className={'dropzone' + (dragging ? ' dragging' : '')}
            onDragOver={(event) => { event.preventDefault(); if (!task.pending) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); if (!task.pending) choose(event.dataTransfer.files[0]); }}>
            <input ref={input} className="visually-hidden" aria-label="Choose resume file" type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={task.pending} onChange={(event) => choose(event.target.files[0])} />
            <span className="icon-tile"><CloudUpload size={23} /></span>
            <strong>{file?.name || 'Choose a file or drag it here'}</strong><small>PDF or DOCX · up to {maxResumeMb} MB</small>
          </label>
          <Notice>{validation || task.error}</Notice>
          <button className="button primary" disabled={!file || task.pending}><CloudUpload size={17} />{task.pending ? 'Working…' : 'Upload and extract'}</button>
        </form>
      </section>
      <section className="panel">
        <h2>Saved resumes <span className="count">{resumes.length}</span></h2>
        {resumes.length ? <div className="list">{resumes.map((resume) => <Link className={'list-row' + (resume._id === selected?._id ? ' row-selected' : '')} key={resume._id} to={'?resume=' + resume._id}>
          <span className="icon-tile"><FileText size={19} /></span>
          <span className="list-title"><strong>{resume.fileName}</strong><small><DateLabel value={resume.createdAt} /></small></span>
          <span className="list-meta">{resume.parsed.skills.length} skills</span>
        </Link>)}</div> : <Empty title="No saved resumes" detail="Your uploaded resumes and extracted skills will appear here." />}
      </section>
    </div>
    {selected && <ResumeDetails resume={selected} remove={remove} pending={task.pending} />}
  </>;
}

function ResumeDetails({ resume, remove, pending }) {
  const { parsed } = resume;
  const groups = Object.groupBy(parsed.skills, (skill) => skill.category);
  return <section className="panel detail-panel">
    <div className="section-heading"><div><h2>{resume.fileName}</h2><p className="muted">{parsed.totalYears ? parsed.totalYears + ' years of experience detected' : 'No duration of experience detected'}</p></div>
      <div className="button-group"><Source source={parsed.extractionSource} />
        <button className="icon-button danger-text" type="button" title="Delete resume" aria-label="Delete resume" onClick={remove} disabled={pending}><Trash2 size={18} /></button>
      </div>
    </div>
    {Object.entries(groups).map(([category, skills]) => <div className="detail-section" key={category}>
      <h3>{category}</h3><div className="chips">{skills.map((skill) => <details key={skill.name} className="skill-evidence"><summary>{skill.name}</summary><p>{skill.evidence}</p></details>)}</div>
    </div>)}
    {parsed.skills.length === 0 && <p className="muted">No skills were detected in the resume text.</p>}
    {[['Experience', parsed.experience], ['Education', parsed.education], ['Projects', parsed.projects]].map(([label, items]) =>
      items.length > 0 && <div className="detail-section" key={label}><h3>{label}</h3><ul className="plain-list">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>)}
    <Link className="button secondary" to={'/compare?resume=' + resume._id}>Compare with a job<ArrowRight size={16} /></Link>
  </section>;
}

export function Jobs() {
  const { jobs, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const selected = jobs.find((item) => item._id === params.get('job'));
  const task = useTask();
  const [posting, setPosting] = useState(null);
  const postingTask = useTask();

  function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    task.run(async () => {
      const { data } = await api.post('/job-descriptions', payload);
      await refresh();
      form.reset();
      setParams({ job: data._id });
    });
  }

  function remove() {
    if (!window.confirm('Delete this job description and its fit reports and interviews?')) return;
    task.run(async () => {
      await api.delete('/job-descriptions/' + selected._id);
      await refresh();
      setParams({});
    });
  }

  function viewPosting() {
    if (posting?._id === selected._id) {
      setPosting(null);
      return;
    }
    postingTask.run(async () => {
      const { data } = await api.get('/job-descriptions/' + selected._id);
      setPosting(data);
    });
  }

  return <>
    <PageHeading title="Job descriptions" description="Save the roles you’re targeting and review what each posting asks for." />
    <div className="library-grid">
      <section className="panel">
        <h2>Add a job description</h2>
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <label>Job title<input name="title" placeholder="Backend Engineer" minLength={2} maxLength={140} required /></label>
            <label>Company <span className="optional">(optional)</span><input name="company" placeholder="Example Co." maxLength={140} /></label>
          </div>
          <label>Job description<textarea name="rawText" rows={7} placeholder="Paste the responsibilities and qualifications from the posting." minLength={40} maxLength={20_000} required /></label>
          <Notice>{task.error}</Notice>
          <button className="button primary" disabled={task.pending}><Plus size={17} />{task.pending ? 'Saving…' : 'Save job description'}</button>
        </form>
      </section>
      <section className="panel">
        <h2>Saved jobs <span className="count">{jobs.length}</span></h2>
        {jobs.length ? <div className="list">{jobs.map((job) => <Link className={'list-row' + (job._id === selected?._id ? ' row-selected' : '')} key={job._id} to={'?job=' + job._id}>
          <span className="icon-tile"><BriefcaseBusiness size={19} /></span>
          <span className="list-title"><strong>{job.title}</strong><small>{job.company ? job.company + ' · ' : ''}<DateLabel value={job.createdAt} /></small></span>
          <span className="list-meta">{job.requiredSkills.length} required</span>
        </Link>)}</div> : <Empty icon={BriefcaseBusiness} title="No saved jobs" detail="Add a posting to compare it with your resume and start interview practice." />}
      </section>
    </div>
    {selected && <section className="panel detail-panel">
      <div className="section-heading"><div><h2>{selected.title}</h2><p className="muted">{[selected.company, selected.seniority, selected.minimumYears ? selected.minimumYears + '+ years' : ''].filter(Boolean).join(' · ')}</p></div>
        <div className="button-group"><Source source={selected.extractionSource} />
          <button className="icon-button danger-text" type="button" title="Delete job" aria-label="Delete job" onClick={remove} disabled={task.pending}><Trash2 size={18} /></button>
        </div>
      </div>
      {[['Required skills', selected.requiredSkills], ['Preferred skills', selected.preferredSkills], ['Education and certifications', selected.educationRequirements]].map(([label, items]) =>
        <div className="detail-section" key={label}><h3>{label}</h3>{items.length ? <div className="chips">{items.map((item) => <Chip key={item}>{item}</Chip>)}</div>
          : <p className="muted">None detected</p>}</div>)}
      <div className="button-group">
        <Link className="button secondary" to={'/compare?job=' + selected._id}>Compare with a resume<ArrowRight size={16} /></Link>
        <button className="text-button" type="button" onClick={viewPosting} disabled={postingTask.pending}>
          {postingTask.pending ? 'Loading…' : posting?._id === selected._id ? 'Hide original posting' : 'View original posting'}
        </button>
      </div>
      <Notice>{postingTask.error}</Notice>
      {posting?._id === selected._id && <p className="posting-text">{posting.rawText}</p>}
    </section>}
  </>;
}
