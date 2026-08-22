import type { UserDto } from '@reachinbox/contracts';
import { useQuery } from '@tanstack/react-query';
import { Filter, RefreshCw, Search, Star } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { Sidebar } from '../components/Sidebar';

export function DashboardPage({ user, view }: { user: UserDto; view: 'scheduled' | 'sent' }) {
  const [search, setSearch] = useState('');
  const emails = useQuery({ queryKey: ['emails', view], queryFn: () => api.getEmails(view) });
  const scheduled = useQuery({ queryKey: ['emails', 'scheduled'], queryFn: () => api.getEmails('scheduled') });
  const sent = useQuery({ queryKey: ['emails', 'sent'], queryFn: () => api.getEmails('sent') });
  const visible = (emails.data?.items ?? []).filter((email) =>
    `${email.recipient} ${email.subject}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <main className="mail-shell">
      <Sidebar user={user} counts={{ scheduled: scheduled.data?.total ?? 0, sent: sent.data?.total ?? 0 }} />
      <section className="mail-main">
        <header className="mail-toolbar">
          <label><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" /></label>
          <button className="icon-button" title="Filter"><Filter size={17} /></button>
          <button className="icon-button" title="Refresh" onClick={() => emails.refetch()}><RefreshCw size={17} /></button>
        </header>
        <div className="mobile-title"><strong>{view === 'scheduled' ? 'Scheduled' : 'Sent'}</strong></div>
        {emails.isLoading && <div className="list-state"><span className="spinner" />Loading emails</div>}
        {emails.isError && <div className="list-state error">Could not load emails. <button onClick={() => emails.refetch()}>Try again</button></div>}
        {!emails.isLoading && !emails.isError && visible.length === 0 && (
          <div className="empty-state"><div>{view === 'scheduled' ? <RefreshCw /> : <SendIcon />}</div><h2>No {view} emails</h2><p>{search ? 'No email matches this search.' : view === 'scheduled' ? 'Scheduled emails will appear here.' : 'Delivered emails will appear here.'}</p></div>
        )}
        <div className="email-list">
          {visible.map((email) => (
            <article className="email-row" key={email.id}>
              <strong>To: {email.recipient}</strong>
              <span className={`status-pill ${email.status.toLowerCase()}`}>{email.status === 'QUEUED' ? new Date(email.scheduledAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : email.status.toLowerCase().replace('_', ' ')}</span>
              <p><b>{email.subject}</b><em> - {email.bodyPreview}</em></p>
              <button className="icon-button" title="Star"><Star size={17} /></button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function SendIcon() {
  return <span aria-hidden="true">✓</span>;
}