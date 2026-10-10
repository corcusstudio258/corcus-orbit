// Every permission the app understands. Roles are built by the admin from this list.
const PERMISSIONS = [
  { key: 'dashboard.team', group: 'Dashboard', label: 'See team-wide dashboard & reports' },

  { key: 'tasks.create', group: 'Tasks', label: 'Create tasks' },
  { key: 'tasks.view_all', group: 'Tasks', label: 'See every task in the company' },
  { key: 'tasks.edit_all', group: 'Tasks', label: 'Edit any task (not only own/assigned)' },
  { key: 'tasks.assign', group: 'Tasks', label: 'Assign tasks to other people' },
  { key: 'tasks.delete', group: 'Tasks', label: 'Delete tasks' },
  { key: 'tasks.approve', group: 'Tasks', label: 'Approve tasks sent for review' },

  { key: 'projects.view_all', group: 'Projects', label: 'See every project' },
  { key: 'projects.manage', group: 'Projects', label: 'Create, edit & archive projects' },

  { key: 'clients.view', group: 'Clients', label: 'See clients' },
  { key: 'clients.manage', group: 'Clients', label: 'Add & edit clients and their portal logins' },

  { key: 'users.view', group: 'Team', label: 'See team directory' },
  { key: 'users.manage', group: 'Team', label: 'Add, edit & deactivate team members' },
  { key: 'roles.manage', group: 'Team', label: 'Create & edit roles' },

  { key: 'settings.manage', group: 'Settings', label: 'Company & WhatsApp settings' },
];

const ALL = PERMISSIONS.map((p) => p.key);

const DEFAULT_ROLES = [
  { name: 'Admin', slug: 'admin', level: 1, color: '#8F7BFF', isSystem: true, permissions: ALL,
    description: 'Full control of the workspace' },
  { name: 'Manager', slug: 'manager', level: 2, color: '#3DE0F2', isSystem: false,
    description: 'Runs projects and their teams',
    permissions: ['dashboard.team', 'tasks.create', 'tasks.view_all', 'tasks.edit_all', 'tasks.assign', 'tasks.delete',
      'tasks.approve', 'projects.view_all', 'projects.manage', 'clients.view', 'users.view'] },
  { name: 'Team Lead', slug: 'team-lead', level: 3, color: '#5BE3A6', isSystem: false,
    description: 'Leads a small squad and reviews their work',
    permissions: ['tasks.create', 'tasks.assign', 'tasks.approve', 'clients.view', 'users.view'] },
  { name: 'Executive', slug: 'executive', level: 4, color: '#FFB648', isSystem: false,
    description: 'Works on assigned tasks',
    permissions: ['tasks.create', 'users.view'] },
  { name: 'Client', slug: 'client', level: 99, color: '#FF7A90', isSystem: true, isClientRole: true,
    description: 'Client portal access only', permissions: [] },
];

module.exports = { PERMISSIONS, ALL, DEFAULT_ROLES };
