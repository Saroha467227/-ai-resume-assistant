import { ArrowRight, ChartNoAxesCombined, ChartPie, CircleCheck, MessageCircle, Target } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from './api.js';
import { Chip, DateLabel, Empty, Notice, PageHeading, PairFields, ResourcePrompt, useTask } from './components.jsx';
import { useWorkspace } from './workspace.jsx';

const metrics = { skills: 'Required skills', preferred: 'Preferred skills', experience: 'Experience', education: 'Education and certifications' };

export function Compare() {
  const { resumes, jobs, reports, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const chosen = reports.find((report) => report._id === params.get('report'));
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

  return <>
    <PageHeading title="Fit analysis" description="Compare what your resume shows with the requirements in a job posting." />
    <section className="panel">
      <h2>Compare a resume and job</h2>
      {resumes.length && jobs.length ? <form key={initial.resumeId + ':' + initial.jdId} className="stack" onSubmit={compare}>
        <PairFields resumes={resumes} jobs={jobs} initial={initial} />
        <Notice>{task.error}</Notice>
        <button className="button primary" disabled={task.pending}><ChartNoAxesCombined size={17} />{task.pending ? 'Comparing…' : 'Compare resume and job'}</button>
      </form> : <ResourcePrompt resumes={resumes} jobs={jobs} />}
    </section>
    {chosen && <Report report={chosen} job={jobs.find((item) => item._id === chosen.jdId)} />}
    <section className="panel">
      <h2>Saved fit reports <span className="count">{reports.length}</span></h2>
      {reports.length ? <div className="list">{reports.map((report) => <Link className={'list-row' + (report._id === chosen?._id ? ' row-selected' : '')} to={'?report=' + report._id} key={report._id}>
        <span className="icon-tile"><ChartPie size={18} /></span>
        <span className="list-title"><strong>{jobs.find((item) => item._id === report.jdId)?.title || 'Fit report'}</strong>
          <small>{resumes.find((item) => item._id === report.resumeId)?.fileName} · <DateLabel value={report.updatedAt} /></small></span>
        <span className="list-meta">{report.score === null ? '—' : report.score + '/100'}</span>
      </Link>)}</div> : <Empty icon={ChartPie} title="No fit reports yet" detail="Choose a resume and job to generate your first report." />}
    </section>
  </>;
}

function Report({ report, job }) {
  return <section className="panel report" aria-label="Fit report">
    <div className="section-heading"><div><h2>{job?.title || 'Fit report'}</h2><p className="muted">Resume evidence against job requirements</p></div>
      <Link className="button secondary" to={'/interviews?resume=' + report.resumeId + '&job=' + report.jdId}><MessageCircle size={17} /> Practice this interview</Link>
    </div>
    <div className="report-metrics">
      <div className="score-tile"><Target size={23} /><span>Job fit</span><strong>{report.score ?? '—'}{report.score !== null && <small>/100</small>}</strong>
        <p>{report.score === null ? 'No scorable requirements were detected.' : 'Based on requirements detected in this posting.'}</p>
      </div>
      <div className="report-breakdown">{Object.entries(metrics).map(([key, label]) => {
        const item = report.breakdown[key];
        return <div className="metric" key={key}>
          <div><strong>{label}</strong><span>{item.percent === null ? 'Unspecified' : item.percent + '% · Weight ' + item.weight}</span></div>
          {item.percent !== null && <progress value={item.percent} max={100} aria-label={label} />}
        </div>;
      })}</div>
    </div>
    <div className="form-grid detail-section">
      <div><h3><CircleCheck size={17} /> Matched required skills</h3><div className="chips">{report.matched.length ? report.matched.map((skill) => <Chip tone="green" check key={skill}>{skill}</Chip>) : <p className="muted">None detected</p>}</div></div>
      <div><h3><Target size={17} /> Missing required skills</h3><div className="chips">{report.missing.length ? report.missing.map((skill) => <Chip tone="amber" key={skill}>{skill}</Chip>) : <p className="muted">None detected</p>}</div></div>
    </div>
    {report.missingPreferred.length > 0 && <div className="detail-section"><h3>Missing preferred skills</h3><div className="chips">{report.missingPreferred.map((skill) => <Chip key={skill}>{skill}</Chip>)}</div></div>}
    <div className="detail-section"><h3>Ways to strengthen your resume</h3><ul className="suggestions">{report.suggestions.map((suggestion) => <li key={suggestion}><ArrowRight size={16} />{suggestion}</li>)}</ul></div>
  </section>;
}
