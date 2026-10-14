// Every permission the app understands. Roles are built by the admin from this list.
// `hint` explains in plain words what switching it on means.
const PERMISSIONS = [
  { key: 'dashboard.team', group: 'Visibility', label: 'Team-wide dashboard', hint: 'See company numbers, everyone’s meetings and the team views instead of only their own.' },
  { key: 'tasks.view_all', group: 'Visibility', label: 'See every task', hint: 'Without this, people see tasks they created, are assigned to, watch, or that belong to people who report to them.' },
  { key: 'projects.view_all', group: 'Visibility', label: 'See every project', hint: 'Without this, people only see projects they are added to as a member or lead (or own).' },
  { key: 'tasks.view_team', group: 'Visibility', label: 'See their team’s work', hint: 'Also see the tasks and projects of people who report to them (set “Reports to” on the Team page).' },
  { key: 'projects.budget', group: 'Visibility', label: 'See budgets and spend', hint: 'Project budget, spend and money figures.' },

  { key: 'tasks.create', group: 'Tasks', label: 'Create tasks', hint: 'Add tasks and subtasks inside projects they can see.' },
  { key: 'tasks.assign', group: 'Tasks', label: 'Assign to others', hint: 'Without this, people can only assign tasks to themselves.' },
  { key: 'tasks.edit_all', group: 'Tasks', label: 'Edit any task', hint: 'Change tasks they did not create and are not assigned to.' },
  { key: 'tasks.approve', group: 'Tasks', label: 'Approve work', hint: 'Approve tasks sent for review (never their own work).' },
  { key: 'tasks.delete', group: 'Tasks', label: 'Delete tasks', hint: 'Permanently remove tasks and their subtasks.' },
  { key: 'files.delete', group: 'Tasks', label: 'Delete files and review videos', hint: 'Remove any file or review video on tasks they can see, not only their own uploads.' },

  { key: 'projects.manage', group: 'Projects', label: 'Manage projects', hint: 'Create, edit, archive projects and change their pipeline.' },
  { key: 'templates.manage', group: 'Projects', label: 'Manage templates', hint: 'Save and delete project templates.' },
  { key: 'automations.manage', group: 'Projects', label: 'Manage automations', hint: 'Create the “when this happens, do that” rules.' },

  { key: 'clients.view', group: 'Clients', label: 'See clients', hint: 'Client list, client profiles and their requests.' },
  { key: 'clients.manage', group: 'Clients', label: 'Manage clients', hint: 'Add clients, approve portal sign-ups, create portal logins.' },

  { key: 'users.view', group: 'People', label: 'See team directory', hint: 'Team list with roles and workload.' },
  { key: 'users.invite', group: 'People', label: 'Invite people', hint: 'Send email invites to new team members.' },
  { key: 'users.manage', group: 'People', label: 'Manage team members', hint: 'Edit people, reset passwords and deactivate accounts.' },
  { key: 'attendance.manage', group: 'People', label: 'Manage attendance', hint: 'Mark leave or absence for others and export attendance.' },
  { key: 'roles.manage', group: 'People', label: 'Manage roles', hint: 'Create and edit roles below their own level.' },
  { key: 'rewards.view_all', group: 'People', label: 'See everyone’s points', hint: 'Full leaderboard with points and anyone’s points history. Without this, people see only their own points and rank.' },
  { key: 'rewards.manage', group: 'People', label: 'Give bonus points', hint: 'Give up to 100 points at once. Everyone else can give 10-point kudos, 3 times a day.' },

  { key: 'ai.use', group: 'Workspace', label: 'Use Orbit AI', hint: 'Ask Orbit, AI reports, smart task entry and writing help.' },
  { key: 'settings.manage', group: 'Workspace', label: 'Workspace settings', hint: 'Company details, AI, email, Zoom and WhatsApp settings.' },
];

const ALL = PERMISSIONS.map((p) => p.key);

const DEFAULT_ROLES = [
  { name: 'Admin', slug: 'admin', level: 1, color: '#8B5CF6', isSystem: true, permissions: ALL,
    description: 'Full control of the workspace' },
  { name: 'Manager', slug: 'manager', level: 2, color: '#3D5AFE', isSystem: false,
    description: 'Runs projects and their teams',
    permissions: ['dashboard.team', 'tasks.create', 'tasks.view_all', 'tasks.edit_all', 'tasks.assign', 'tasks.delete', 'files.delete',
      'tasks.approve', 'tasks.view_team', 'projects.view_all', 'projects.manage', 'projects.budget', 'templates.manage', 'automations.manage',
      'clients.view', 'users.view', 'users.invite', 'attendance.manage', 'rewards.view_all', 'rewards.manage', 'ai.use'] },
  { name: 'Team Lead', slug: 'team-lead', level: 3, color: '#1FA971', isSystem: false,
    description: 'Leads a small squad and reviews their work',
    permissions: ['tasks.create', 'tasks.assign', 'tasks.approve', 'tasks.view_team', 'files.delete', 'clients.view', 'users.view', 'ai.use'] },
  { name: 'Executive', slug: 'executive', level: 4, color: '#C76A00', isSystem: false,
    description: 'Works on assigned tasks',
    permissions: ['tasks.create', 'users.view', 'ai.use'] },
  { name: 'Client', slug: 'client', level: 99, color: '#E5484D', isSystem: true, isClientRole: true,
    description: 'Client portal access only', permissions: [] },
];

module.exports = { PERMISSIONS, ALL, DEFAULT_ROLES };
