import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bold, Clock3, Italic, List, ListOrdered, Paperclip, Trash2, Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

function extractEmails(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

export function ComposePage() {
  const navigate = useNavigate();
  const senders = useQuery({ queryKey: ['senders'], queryFn: api.getSenders });
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');
  const [subject, setSubject] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [startAt, setStartAt] = useState('');
  const [senderId, setSenderId] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const editor = useEditor({ extensions: [StarterKit, Placeholder.configure({ placeholder: 'Type your message...' })], content: '' });

  const schedule = useMutation({
    mutationFn: async () => {
      const chosenSender = senderId || senders.data?.senders[0]?.id;
      if (!chosenSender || !editor || recipients.length === 0 || !subject.trim() || !startAt) throw new Error('Complete all required fields');
      if (attachments.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) throw new Error('Attachments exceed 10 MB total');
      const formData = new FormData();
      formData.set('payload', JSON.stringify({ senderId: chosenSender, recipients, subject, htmlBody: editor.getHTML(), startAt: new Date(startAt).toISOString(), delaySeconds, hourlyLimit }));
      attachments.forEach((file) => formData.append('attachments', file));
      return api.schedule(formData);
    },
    onSuccess: (result) => { setNotice(`${result.count} emails scheduled`); setTimeout(() => navigate('/scheduled'), 700); },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Could not schedule emails'),
  });

  function addRecipientInput() {
    const next = extractEmails(recipientInput);
    setRecipients((current) => [...new Set([...current, ...next])]);
    setRecipientInput('');
  }

  async function readLeadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const found = extractEmails(await file.text());
    setRecipients((current) => [...new Set([...current, ...found])]);
    setNotice(`${found.length} valid email addresses detected`);
    event.target.value = '';
  }

  return (
    <main className="compose-page">
      <header><button className="icon-button" onClick={() => navigate(-1)} title="Back"><ArrowLeft /></button><h1>Compose New Email</h1><div className="compose-actions"><label className="icon-button" title="Attach files"><Paperclip /><input hidden type="file" multiple onChange={(event) => setAttachments([...event.target.files ?? []])} /></label><Clock3 size={20} /><button className="outline-action" disabled={schedule.isPending} onClick={() => schedule.mutate()}>{schedule.isPending ? 'Scheduling...' : 'Send Later'}</button></div></header>
      <section className="compose-form">
        <div className="form-row"><label>From</label><select value={senderId} onChange={(event) => setSenderId(event.target.value)}><option value="">Select sender</option>{senders.data?.senders.map((sender) => <option value={sender.id} key={sender.id}>{sender.email}</option>)}</select></div>
        <div className="form-row recipients-row"><label>To</label><div className="recipient-field">{recipients.slice(0, 4).map((email) => <button key={email} onClick={() => setRecipients(recipients.filter((item) => item !== email))}>{email}</button>)}{recipients.length > 4 && <span>+{recipients.length - 4}</span>}<input value={recipientInput} onChange={(event) => setRecipientInput(event.target.value)} onBlur={addRecipientInput} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addRecipientInput(); } }} placeholder={recipients.length ? '' : 'recipient@example.com'} /></div><label className="upload-list"><Upload size={15} />Upload List<input hidden type="file" accept=".csv,.txt,text/csv,text/plain" onChange={readLeadFile} /></label></div>
        <div className="form-row"><label>Subject</label><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" /></div>
        <div className="schedule-grid"><label>Delay between emails <input type="number" min="1" value={delaySeconds} onChange={(event) => setDelaySeconds(Number(event.target.value))} /><span>sec</span></label><label>Hourly limit <input type="number" min="1" max="10000" value={hourlyLimit} onChange={(event) => setHourlyLimit(Number(event.target.value))} /></label><label>Start time <input type="datetime-local" value={startAt} min={new Date().toISOString().slice(0, 16)} onChange={(event) => setStartAt(event.target.value)} /></label></div>
        <div className="editor-shell"><div className="editor-toolbar"><button title="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}><Bold /></button><button title="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic /></button><button title="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()}><List /></button><button title="Numbered list" onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered /></button></div><EditorContent editor={editor} /></div>
        {attachments.length > 0 && <div className="attachment-strip">{attachments.map((file) => <div key={`${file.name}-${file.size}`}><Paperclip /><span>{file.name}<small>{(file.size / 1024).toFixed(0)} KB</small></span><button title="Remove attachment" onClick={() => setAttachments(attachments.filter((item) => item !== file))}><Trash2 /></button></div>)}</div>}
        {notice && <div className="toast" role="status">{notice}</div>}
      </section>
    </main>
  );
}