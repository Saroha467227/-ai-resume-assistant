import { Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from './auth.jsx';
import { api } from './api.js';
import { Notice, PageHeading, useTask } from './components.jsx';

export function Settings() {
  const { user, setUser } = useAuth();
  const [saved, setSaved] = useState(false);
  const task = useTask();
  const deletion = useTask();

  function save(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    setSaved(false);
    task.run(async () => {
      const { data } = await api.patch('/auth/me', payload);
      setUser(data);
      setSaved(true);
    });
  }

  function remove(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!window.confirm('Permanently delete your account, resumes, job descriptions, fit reports, and interviews?')) return;
    deletion.run(async () => {
      await api.delete('/auth/me', { data });
      setUser(null);
    });
  }

  return <>
    <PageHeading title="Settings" description="Update your profile or delete your workspace data." />
    <section className="panel narrow">
      <h2>Profile</h2>
      <form className="stack" onSubmit={save}>
        <label>Name<input name="name" defaultValue={user.name} minLength={2} maxLength={80} autoComplete="name" required /></label>
        <label>Email<input type="email" value={user.email} readOnly /></label>
        <label>Target role<input name="targetRole" defaultValue={user.targetRole} maxLength={100} placeholder="Backend Engineer" /></label>
        <Notice>{task.error}</Notice><Notice tone="success">{saved && 'Profile updated.'}</Notice>
        <button className="button primary" disabled={task.pending}><Save size={17} />{task.pending ? 'Saving…' : 'Save profile'}</button>
      </form>
    </section>
    <section className="panel narrow">
      <details className="account-deletion"><summary><Trash2 size={17} /> Delete account</summary>
        <p className="muted">Permanently remove your account and all associated workspace data.</p>
        <form className="stack" onSubmit={remove}>
          <label>Confirm password<input required type="password" name="password" autoComplete="current-password" maxLength={72} /></label>
          <Notice>{deletion.error}</Notice>
          <button className="button danger" disabled={deletion.pending}>{deletion.pending ? 'Deleting…' : 'Delete my account'}</button>
        </form>
      </details>
    </section>
  </>;
}
