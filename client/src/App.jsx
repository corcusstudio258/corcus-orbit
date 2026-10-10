import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { PageLoader } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TaskDetail from './pages/TaskDetail';
import Projects, { ProjectDetail } from './pages/Projects';
import Clients, { ClientDetail, Requests } from './pages/Clients';
import Team from './pages/Team';
import Roles from './pages/Roles';
import Settings from './pages/Settings';
import { MyTasks, Board, Calendar, ActivityPage } from './pages/Simple';
import { PortalLayout, PortalHome, PortalProject, PortalTask, PortalRequests } from './portal/Portal';

function Gate({ children, client }) {
  const { user, loading, isClient } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (client && !isClient) return <Navigate to="/" replace />;
  if (!client && isClient) return <Navigate to="/portal" replace />;
  return children;
}

function Perm({ need, children }) {
  const { can } = useAuth();
  return can(...need) ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { user, isClient, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <PageLoader /> : user ? <Navigate to={isClient ? '/portal' : '/'} replace /> : <Login />} />
      <Route path="/portal" element={<Gate client><PortalLayout /></Gate>}>
        <Route index element={<PortalHome />} />
        <Route path="projects/:id" element={<PortalProject />} />
        <Route path="tasks/:id" element={<PortalTask />} />
        <Route path="requests" element={<PortalRequests />} />
      </Route>
      <Route element={<Gate><Layout /></Gate>}>
        <Route index element={<Dashboard />} />
        <Route path="my-tasks" element={<MyTasks />} />
        <Route path="board" element={<Board />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="clients" element={<Perm need={['clients.view', 'clients.manage']}><Clients /></Perm>} />
        <Route path="clients/:id" element={<Perm need={['clients.view', 'clients.manage']}><ClientDetail /></Perm>} />
        <Route path="requests" element={<Perm need={['clients.view', 'clients.manage']}><Requests /></Perm>} />
        <Route path="team" element={<Perm need={['users.view', 'users.manage']}><Team /></Perm>} />
        <Route path="team/:id" element={<Perm need={['users.view', 'users.manage']}><Team /></Perm>} />
        <Route path="roles" element={<Perm need={['roles.manage']}><Roles /></Perm>} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
