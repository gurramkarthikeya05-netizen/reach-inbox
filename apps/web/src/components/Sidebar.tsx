import type { UserDto } from '@reachinbox/contracts';
import { Clock3, LogOut, Send } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';

export function Sidebar({ user, counts }: { user: UserDto; counts: { scheduled: number; sent: number } }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/login');
    },
  });

  return (
    <aside className="sidebar">
      <div className="brand-mark">ONB</div>
      <div className="profile">
        {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{user.name[0]}</span>}
        <div><strong>{user.name}</strong><small>{user.email}</small></div>
        <button className="icon-button" title="Log out" onClick={() => logout.mutate()}><LogOut size={16} /></button>
      </div>
      <Link className="compose-button" to="/compose">Compose</Link>
      <p className="nav-label">CORE</p>
      <nav>
        <NavLink to="/scheduled"><Clock3 size={17} /><span>Scheduled</span><small>{counts.scheduled}</small></NavLink>
        <NavLink to="/sent"><Send size={17} /><span>Sent</span><small>{counts.sent}</small></NavLink>
      </nav>
    </aside>
  );
}