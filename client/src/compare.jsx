import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, FileText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, messageFrom } from './api.js';
import { Chip, DateLabel, Empty, Notice, PageHeading, PairFields, ResourcePrompt, useTask } from './components.jsx';
import { HistoryPagination, useWorkspace } from './workspace.jsx';
import './compare.css';

const metrics = { skills: 'Required skills', preferred: 'Preferred skills', experience: 'Experience', education: 'Education and certifications' };

export function Compare() {
  const { resumes, jobs, reports, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const reportId = params.get('report');
  const listedReport = reports.find((report) => report._id === reportId);
  const [detail, setDetail] = useState(null);
  const chosen = listedReport || (detail?.id === reportId ? detail.report : null);
  useEffect(() => {
    if (!reportId || listedReport) return;
    const controller = new AbortController();
    api.get('/analyses/' + encodeURIComponent(reportId), { signal: controller.signal })
      .then(({ data }) => setDetail({ id: reportId, report: data }))
      .catch((error) => {
        if (!controller.signal.aborted) setDetail({ id: reportId, error: messageFrom(error) });
      });
    return () => controller.abort();
  }, [reportId, listedReport]);
  const initial = {
    resumeId: chosen?.resumeId || params.get('resume'),
    jdId: chosen?.jdId || params.get('job')
  };
  const task = useTask();
  function compare(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    task.run(async () => {
      const { data } = await api.post('/analyses', payload);
      await refresh();
      setParams({ report: data._id });
    });
  }

  return <div className="compare-screen">
    <PageHeading title="Fit analysis" description="Review your résumé against the job requirements." />
    <Notice>{!chosen && detail?.id === reportId && detail.error}</Notice>
    <section className="panel compare-controls" aria-label="Choose a résumé and job">
      {resumes.length && jobs.length ? <form key={initial.resumeId + ':' + initial.jdId} onSubmit={compare}>
        <PairFields resumes={resumes} jobs={jobs} initial={initial} />
        <button className="button primary" disabled={task.pending}>{task.pending ? 'Analyzing…' : 'Run fit analysis'}<ArrowRight size={16} /></button>
        <Notice>{task.error}</Notice>
      </form> : <ResourcePrompt resumes={resumes} jobs={jobs} />}
    </section>
    {chosen && <Report report={chosen}
      resume={resumes.find((item) => item._id === chosen.resumeId)}
      job={jobs.find((item) => item._id === chosen.jdId)} />}
    <section className="panel compare-history">
      <h2>Saved fit reports</h2>
      {reports.length ? <div className="list">{reports.map((report) => <Link className={'list-row' + (report._id === chosen?._id ? ' row-selected' : '')} to={'?report=' + report._id} key={report._id}>
        <FileText size={16} aria-hidden="true" />
        <span className="list-title"><strong>{report.jobTitle || jobs.find((item) => item._id === report.jdId)?.title || 'Fit report'}</strong>
          <small>{resumes.find((item) => item._id === report.resumeId)?.fileName} · <DateLabel value={report.updatedAt} /></small></span>
        <span className="list-meta">{report.score === null ? '—' : report.score + '/100'}</span>
      </Link>)}</div> : <Empty icon={FileText} title="No fit reports yet" detail="Choose a resume and job to generate your first report." />}
      <HistoryPagination section="reports" />
    </section>
  </div>;
}

function Report({ report, resume, job }) {
  return <section className="panel report" aria-label="Fit report">
    <header className="compare-report-heading">
      <div><h2>{job?.title || report.jobTitle || 'Fit report'}</h2>{job?.company && <p>{job.company}</p>}</div>
      <div className="compare-fit-score">
        <span>Job fit</span>
        <strong>{report.score ?? '—'}{report.score !== null && <small>/100</small>}</strong>
      </div>
    </header>
    {report.score === null && <p className="compare-report-note">No scorable requirements were detected.</p>}
    <div className="compare-review-grid">
      <ResumePreview key={report.resumeId} resume={resume} />
      <section className="compare-feedback" aria-label="Résumé feedback">
        <h3>Suggested revisions</h3>
        <ul className="compare-suggestions">{report.suggestions.map((suggestion) =>
          <Suggestion key={suggestion} suggestion={suggestion} />)}</ul>
        <section className="compare-matches">
          <h3>Skills comparison</h3>
          <SkillGroup title="Missing required skills" skills={report.missing} tone="amber" />
          <SkillGroup title="Matched required skills" skills={report.matched} check />
          {report.missingPreferred.length > 0 && <SkillGroup title="Missing preferred skills" skills={report.missingPreferred} />}
        </section>
        <details className="compare-breakdown">
          <summary>Score breakdown<ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="report-breakdown">{Object.entries(metrics).map(([key, label]) => {
            const item = report.breakdown[key];
            return <div className="metric" key={key}>
              <div><strong>{label}</strong><span>{item.percent === null ? 'Unspecified' : item.percent + '% · Weight ' + item.weight}</span></div>
              {item.percent !== null && <progress value={item.percent} max={100} aria-label={label} />}
            </div>;
          })}</div>
        </details>
        <Link className="compare-interview-link" to={'/interviews?resume=' + report.resumeId + '&job=' + report.jdId}>Practice this interview<ArrowRight size={16} aria-hidden="true" /></Link>
      </section>
    </div>
  </section>;
}

function ResumePreview({ resume }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = resume?.parsed;
  if (!parsed) return <section className="compare-preview" aria-labelledby="resume-preview-title">
    <h3 id="resume-preview-title">Résumé preview</h3>
    <p className="muted">Résumé details are unavailable.</p>
  </section>;

  const sections = [
    ['Experience', parsed.experience],
    ['Projects', parsed.projects],
    ['Education', parsed.education]
  ].filter(([, lines]) => lines?.length);
  const skills = (parsed.skills || []).map((skill) => skill.name);

  return <section className="compare-preview" aria-labelledby="resume-preview-title">
    <h3 id="resume-preview-title">Résumé preview</h3>
    <div className="compare-paper">
      <div className="compare-paper-header">
        <div><p className="compare-filename">{resume.fileName}</p>
          <p className="compare-paper-meta">Extracted résumé text{parsed.totalYears > 0 && ' · ' + parsed.totalYears + ' years detected'}</p></div>
        <button type="button" className="compare-preview-toggle" aria-expanded={expanded}
          aria-controls="compare-resume-content" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide preview' : 'Show preview'}<ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      <div id="compare-resume-content" className="compare-paper-body" data-expanded={expanded}>
        {sections.map(([label, lines]) => <div className="compare-paper-section" key={label}>
          <h4>{label}</h4>
          <ul>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </div>)}
        {skills.length > 0 && <div className="compare-paper-section"><h4>Skills</h4><p>{skills.join(', ')}</p></div>}
        {!sections.length && !skills.length && <p className="muted">No résumé sections were extracted.</p>}
      </div>
    </div>
  </section>;
}

function Suggestion({ suggestion }) {
  const specific = /^If you have hands-on experience with ([^,]+), (.+)$/.exec(suggestion);
  return <li>
    {specific ? <><strong>{specific[1]} experience</strong><p>If applicable, {specific[2]}</p></> : <p>{suggestion}</p>}
  </li>;
}

function SkillGroup({ title, skills, tone, check }) {
  return <div className="compare-skill-group">
    <h4>{title}</h4>
    {skills.length ? <div className="chips">{skills.map((skill) => <Chip tone={tone} check={check} key={skill}>{skill}</Chip>)}</div>
      : <p className="muted">None detected</p>}
  </div>;
}
