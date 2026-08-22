import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { ComposePage } from './pages/ComposePage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.getMe });

  if (me.isLoading) return <div className="app-loader"><span /></div>;
  if (me.isError) return <div className="center-message">Could not connect to scheduler API.</div>;
  if (!me.data?.user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/scheduled" replace />} />
      <Route path="/scheduled" element={<DashboardPage user={me.data.user} view="scheduled" />} />
      <Route path="/sent" element={<DashboardPage user={me.data.user} view="sent" />} />
      <Route path="/compose" element={<ComposePage />} />
      <Route path="*" element={<Navigate to="/scheduled" replace />} />
    </Routes>
  );
}