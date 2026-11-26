import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageCircle, Send, Target } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, messageFrom } from './api.js';
import { Chip, DateLabel, Empty, Loading, Notice, PageHeading, PairFields, ResourcePrompt, Source, useTask } from './components.jsx';
import { useWorkspace } from './workspace.jsx';

const questionTypes = { core: 'Core question', gap: 'Skill gap', claim: 'Resume claim', followup: 'Follow-up' };

export function Interviews() {
  const { resumes, jobs, interviews, refresh } = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const task = useTask();
  function start(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    task.run(async () => {
      const { data } = await api.post('/interviews', payload);
      await refresh();
      navigate('/interviews/' + data._id);
    });
  }

  return <>
    <PageHeading title="Interviews" description="Practice questions about the role, your resume, and the skills you want to strengthen." />
    <section className="panel"><h2>Start a practice interview</h2>
      {resumes.length && jobs.length ? <form className="stack" onSubmit={start}>
        <PairFields resumes={resumes} jobs={jobs} initial={{ resumeId: params.get('resume'), jdId: params.get('job') }} />
        <Notice>{task.error}</Notice>
        <button className="button primary" disabled={task.pending}><MessageCircle size={17} />{task.pending ? 'Preparing questions…' : 'Start interview'}</button>
      </form> : <ResourcePrompt resumes={resumes} jobs={jobs} />}
    </section>
    <section className="panel"><h2>Interview history <span className="count">{interviews.length}</span></h2>
      {interviews.length ? <div className="list">{interviews.map((session) => <Link className="list-row" key={session._id} to={'/interviews/' + session._id}>
        <span className="icon-tile"><MessageCircle size={19} /></span>
        <span className="list-title"><strong>{jobs.find((job) => job._id === session.jdId)?.title || 'Practice session'}</strong>
          <small><DateLabel value={session.updatedAt} /> · {session.turns.filter((turn) => turn.evaluation).length} answered</small></span>
        <Chip tone={session.status === 'complete' ? 'green' : 'amber'}>
          {session.status === 'complete' ? 'Complete · ' + session.summary.score + '/5' : 'In progress'}
        </Chip><ArrowRight size={16} />
      </Link>)}</div> : <Empty icon={MessageCircle} title="No interviews yet" detail="Start a practice session to build your history." />}
    </section>
  </>;
}

export function Interview() {
  const { id } = useParams();
  const { jobs, refresh } = useWorkspace();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [answer, setAnswer] = useState('');
  const task = useTask();

  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setAnswer('');
    setLoadError('');
    api.get('/interviews/' + id, { signal: controller.signal })
      .then(({ data }) => setSession(data))
      .catch((err) => { if (!controller.signal.aborted) setLoadError(messageFrom(err)); });
    return () => controller.abort();
  }, [id]);

  const current = session?.turns.find((turn) => !turn.answer);
  const answered = session?.turns.filter((turn) => turn.answer) || [];
  const job = jobs.find((item) => item._id === session?.jdId);
  const originalIndex = session?.turns.filter((turn) => turn.type !== 'followup')
    .findIndex((turn) => turn.questionId === (current?.parentId || current?.questionId)) ?? -1;

  function submit(event) {
    event.preventDefault();
    if (!answer.trim() || !current) return;
    task.run(async () => {
      const { data } = await api.post('/interviews/' + id + '/answers', { questionId: current.questionId, answer });
      setSession(data);
      setAnswer('');
      await refresh();
    });
  }

  return <>
    <Link className="back-link" to="/interviews"><ArrowLeft size={17} /> All interviews</Link>
    <PageHeading title={job?.title || 'Practice interview'} description={job?.company} />
    <Notice>{loadError}</Notice>
    {!session && !loadError && <Loading text="Loading practice session…" />}
    {session?.summary && <section className="panel detail-panel">
      <div className="section-heading"><div><h2><Check size={20} /> Interview complete</h2><p className="muted">{answered.length} questions and follow-ups answered</p></div>
        <Chip tone="green">{session.summary.score}/5 average</Chip></div>
      {session.summary.weakAreas.length > 0 && <div className="detail-section"><h3>Areas to practice</h3><div className="chips">{session.summary.weakAreas.map((area) => <Chip key={area}>{area}</Chip>)}</div></div>}
      <div className="detail-section"><h3>What to work on next</h3><ul className="suggestions">{session.summary.improvements.map((item) => <li key={item}><Target size={16} />{item}</li>)}</ul></div>
    </section>}
    {current && <section className="panel active-interview">
      <div className="section-heading"><span className="muted">Question {originalIndex + 1} of 5</span><Chip tone="green">{questionTypes[current.type]}</Chip></div>
      <progress value={session.turns.filter((turn) => turn.type !== 'followup' && turn.answer).length} max={5} aria-label="Core interview progress" />
      <h2>{current.text}</h2>
      <form className="stack" onSubmit={submit}>
        <label>Your answer<textarea rows={6} placeholder="Describe what you did, how you did it, and what happened." value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={5000} required disabled={task.pending} /></label>
        <Notice>{task.error}</Notice>
        <button className="button primary" disabled={task.pending || !answer.trim()}><Send size={16} />{task.pending ? 'Reviewing answer…' : 'Submit answer'}</button>
      </form>
    </section>}
    {answered.length > 0 && <section className="panel transcript">
      <h2>Answer feedback</h2>
      {answered.toReversed().map((turn) => <article key={turn.questionId}>
        <div className="section-heading"><Chip>{questionTypes[turn.type]}</Chip><div className="button-group"><Source source={turn.evaluation.source} /><Chip tone={turn.evaluation.score <= 2 ? 'amber' : 'green'}>{turn.evaluation.score}/5</Chip></div></div>
        <h3>{turn.text}</h3><p className="answer-text">{turn.answer}</p>
        <p className="feedback"><strong>Feedback</strong> {turn.evaluation.feedback}</p>
        {turn.evaluation.weakAreas.length > 0 && <div className="chips">{turn.evaluation.weakAreas.map((area) => <Chip key={area}>{area}</Chip>)}</div>}
      </article>)}
    </section>}
  </>;
}
