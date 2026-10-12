import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { PageLoader } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MyTasks from './pages/MyTasks';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import { Board, Calendar, ActivityPage, TaskPage } from './pages/Work';
import { PortalLayout, PortalHome, PortalProject, PortalTask, PortalRequests, PortalDoc, PortalReview, PortalProfile } from './portal/Portal';
import SetPassword from './pages/SetPassword';
import Signup from './pages/Signup';

// Less-visited screens load on demand to keep the first paint light.
const Clients = lazy(() => import('./pages/Clients'));
const ClientDetail = lazy(() => import('./pages/Clients').then((m) => ({ default: m.ClientDetail })));
const Requests = lazy(() => import('./pages/Clients').then((m) => ({ default: m.Requests })));
const Team = lazy(() => import('./pages/Team'));
const Roles = lazy(() => import('./pages/Roles'));
const Settings = lazy(() => import('./pages/Settings'));
const Chat = lazy(() => import('./pages/Chat'));
const Meetings = lazy(() => import('./pages/Meetings'));
const Docs = lazy(() => import('./pages/Docs'));
const AskOrbit = lazy(() => import('./pages/Ai').then((m) => ({ default: m.AskOrbit })));
const Reports = lazy(() => import('./pages/Ai').then((m) => ({ default: m.Reports })));
const Health = lazy(() => import('./pages/Ai').then((m) => ({ default: m.Health })));
const Workload = lazy(() => import('./pages/People').then((m) => ({ default: m.Workload })));
const Attendance = lazy(() => import('./pages/People').then((m) => ({ default: m.Attendance })));
const Rewards = lazy(() => import('./pages/People').then((m) => ({ default: m.Rewards })));
const Automations = lazy(() => import('./pages/Tools').then((m) => ({ default: m.Automations })));
const Templates = lazy(() => import('./pages/Tools').then((m) => ({ default: m.Templates })));
const ImportExport = lazy(() => import('./pages/Tools').then((m) => ({ default: m.ImportExport })));

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

const L = (el) => <Suspense fallback={<PageLoader />}>{el}</Suspense>;

export default function App() {
  const { user, isClient, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <PageLoader /> : user ? <Navigate to={isClient ? '/portal' : '/'} replace /> : <Login />} />
      <Route path="/portal" element={<Gate client><PortalLayout /></Gate>}>
        <Route index element={<PortalHome />} />
        <Route path="projects/:id" element={<PortalProject />} />
        <Route path="tasks/:id" element={<PortalTask />} />
        <Route path="docs/:id" element={<PortalDoc />} />
        <Route path="requests" element={<PortalRequests />} />
        <Route path="review" element={<PortalReview />} />
        <Route path="profile" element={<PortalProfile />} />
      </Route>
      <Route path="/signup" element={loading ? <PageLoader /> : user ? <Navigate to={isClient ? '/portal' : '/'} replace /> : <Signup />} />
      <Route path="/accept" element={<SetPassword purpose="invite" />} />
      <Route path="/reset" element={<SetPassword purpose="reset" />} />
      <Route element={<Gate><Layout /></Gate>}>
        <Route index element={<Dashboard />} />
        <Route path="my-tasks" element={<MyTasks />} />
        <Route path="board" element={<Board />} />
        <Route path="tasks/:id" element={<TaskPage />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="chat" element={L(<Chat />)} />
        <Route path="chat/:id" element={L(<Chat />)} />
        <Route path="meetings" element={L(<Meetings />)} />
        <Route path="docs" element={L(<Docs />)} />
        <Route path="docs/:id" element={L(<Docs />)} />
        <Route path="ai" element={L(<AskOrbit />)} />
        <Route path="ai/reports" element={L(<Reports />)} />
        <Route path="ai/health" element={L(<Health />)} />
        <Route path="workload" element={L(<Workload />)} />
        <Route path="attendance" element={L(<Attendance />)} />
        <Route path="rewards" element={L(<Rewards />)} />
        <Route path="automations" element={L(<Automations />)} />
        <Route path="templates" element={L(<Templates />)} />
        <Route path="import-export" element={L(<ImportExport />)} />
        <Route path="clients" element={<Perm need={['clients.view', 'clients.manage']}>{L(<Clients />)}</Perm>} />
        <Route path="clients/:id" element={<Perm need={['clients.view', 'clients.manage']}>{L(<ClientDetail />)}</Perm>} />
        <Route path="requests" element={<Perm need={['clients.view', 'clients.manage']}>{L(<Requests />)}</Perm>} />
        <Route path="team" element={<Perm need={['users.view', 'users.manage']}>{L(<Team />)}</Perm>} />
        <Route path="team/:id" element={<Perm need={['users.view', 'users.manage']}>{L(<Team />)}</Perm>} />
        <Route path="roles" element={<Perm need={['roles.manage']}>{L(<Roles />)}</Perm>} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={L(<Settings />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
