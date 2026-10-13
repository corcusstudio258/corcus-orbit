const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const json = (name, fallback) => ({
  type: DataTypes.TEXT,
  get() {
    const raw = this.getDataValue(name);
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
  set(v) { this.setDataValue(name, JSON.stringify(v ?? fallback)); },
});

const Role = sequelize.define('Role', {
  name: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  description: DataTypes.STRING,
  level: { type: DataTypes.INTEGER, defaultValue: 10 }, // lower = more senior
  color: { type: DataTypes.STRING, defaultValue: '#8F7BFF' },
  permissions: json('permissions', []),
  isSystem: { type: DataTypes.BOOLEAN, defaultValue: false },
  isClientRole: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Client = sequelize.define('Client', {
  name: { type: DataTypes.STRING, allowNull: false },
  company: DataTypes.STRING,
  email: DataTypes.STRING,
  phone: DataTypes.STRING,
  whatsapp: DataTypes.STRING,
  industry: DataTypes.STRING,
  city: DataTypes.STRING,
  notes: DataTypes.TEXT,
  color: { type: DataTypes.STRING, defaultValue: '#3DE0F2' },
  status: { type: DataTypes.STRING, defaultValue: 'active' }, // pending | active | paused | archived
  logo: DataTypes.STRING, // stored file name in uploads
  website: DataTypes.STRING,
  onboarding: json('onboarding', null), // answers to the onboarding form
  secrets: DataTypes.TEXT, // encrypted JSON of credential answers (admins only)
  signupSource: DataTypes.STRING, // portal | team
  approvedAt: DataTypes.DATE,
}, {
  defaultScope: { attributes: { exclude: ['secrets'] } },
  scopes: { withSecrets: { attributes: { include: ['secrets'] } } },
});

const ClientFile = sequelize.define('ClientFile', {
  originalName: DataTypes.STRING,
  fileName: DataTypes.STRING,
  mime: DataTypes.STRING,
  size: DataTypes.INTEGER,
  category: { type: DataTypes.STRING, defaultValue: 'other' }, // logo | brand | document | other
  note: DataTypes.STRING,
});

const User = sequelize.define('User', {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  phone: DataTypes.STRING, // WhatsApp number with country code, e.g. 919876543210
  whatsappOptIn: { type: DataTypes.BOOLEAN, defaultValue: true },
  designation: DataTypes.STRING,
  department: DataTypes.STRING,
  color: { type: DataTypes.STRING, defaultValue: '#8F7BFF' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastSeenAt: DataTypes.DATE,
  notifyPrefs: json('notifyPrefs', { assigned: true, status: true, comment: true, due: true, approval: true }),
  inviteToken: DataTypes.STRING, // pending invite / password reset token (hashed)
  inviteExpires: DataTypes.DATE,
  invitedAt: DataTypes.DATE,
  invitePurpose: DataTypes.STRING, // invite | reset
}, {
  defaultScope: { attributes: { exclude: ['passwordHash', 'inviteToken'] } },
  scopes: { withPassword: { attributes: { include: ['passwordHash'] } } },
});

const Project = sequelize.define('Project', {
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false }, // short key, used in task keys e.g. KAS-14
  description: DataTypes.TEXT,
  status: { type: DataTypes.STRING, defaultValue: 'active' }, // planning | active | on_hold | completed | archived
  priority: { type: DataTypes.STRING, defaultValue: 'medium' },
  startDate: DataTypes.DATEONLY,
  dueDate: DataTypes.DATEONLY,
  color: { type: DataTypes.STRING, defaultValue: '#3DE0F2' },
  clientVisible: { type: DataTypes.BOOLEAN, defaultValue: true },
  taskCounter: { type: DataTypes.INTEGER, defaultValue: 0 },
  icon: DataTypes.STRING, // emoji
  budget: { type: DataTypes.FLOAT, defaultValue: 0 },
  spent: { type: DataTypes.FLOAT, defaultValue: 0 },
  currency: { type: DataTypes.STRING, defaultValue: 'INR' },
  healthOverride: DataTypes.STRING, // on_track | at_risk | off_track | null (auto)
  pipeline: json('pipeline', { review: true, done: true, archive: true }), // fixed end stages switched on/off
  completedAt: DataTypes.DATE, // set when status becomes completed
  reviewPurgedAt: DataTypes.DATE, // review files cleaned up after completion
});

const ProjectMember = sequelize.define('ProjectMember', {
  role: { type: DataTypes.STRING, defaultValue: 'member' }, // lead | member
});

const Milestone = sequelize.define('Milestone', {
  title: { type: DataTypes.STRING, allowNull: false },
  dueDate: DataTypes.DATEONLY,
  done: { type: DataTypes.BOOLEAN, defaultValue: false },
  order: { type: DataTypes.INTEGER, defaultValue: 0 },
});

const Task = sequelize.define('Task', {
  key: DataTypes.STRING,
  title: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  status: { type: DataTypes.STRING, defaultValue: 'todo' }, // todo | in_progress | review | done | blocked
  priority: { type: DataTypes.STRING, defaultValue: 'medium' }, // low | medium | high | urgent
  depth: { type: DataTypes.INTEGER, defaultValue: 0 },
  startDate: DataTypes.DATEONLY,
  dueDate: DataTypes.DATE,
  estimateHours: DataTypes.FLOAT,
  position: { type: DataTypes.FLOAT, defaultValue: 0 },
  clientVisible: { type: DataTypes.BOOLEAN, defaultValue: false },
  requiresApproval: { type: DataTypes.BOOLEAN, defaultValue: false },
  approvalStatus: { type: DataTypes.STRING, defaultValue: 'none' }, // none | pending | approved | changes_requested
  tags: json('tags', []),
  links: json('links', []),
  storyPoints: DataTypes.INTEGER,
  recurrence: json('recurrence', null), // { freq: 'daily'|'weekly'|'monthly', interval, days:[0-6], until }
  archived: { type: DataTypes.BOOLEAN, defaultValue: false },
  startedAt: DataTypes.DATE,
  completedAt: DataTypes.DATE,
  reminderSentAt: DataTypes.DATE,
  overdueNotifiedAt: DataTypes.DATE,
});

const TaskAssignee = sequelize.define('TaskAssignee', {});

const ChecklistItem = sequelize.define('ChecklistItem', {
  text: { type: DataTypes.STRING, allowNull: false },
  done: { type: DataTypes.BOOLEAN, defaultValue: false },
  position: { type: DataTypes.INTEGER, defaultValue: 0 },
});

const Comment = sequelize.define('Comment', {
  body: { type: DataTypes.TEXT, allowNull: false },
  internal: { type: DataTypes.BOOLEAN, defaultValue: true }, // false = visible to client
  kind: { type: DataTypes.STRING, defaultValue: 'comment' }, // comment | review
  pinX: DataTypes.FLOAT, // 0..1 across the reviewed file
  pinY: DataTypes.FLOAT,
  pinTime: DataTypes.FLOAT, // seconds into a video
  resolved: { type: DataTypes.BOOLEAN, defaultValue: false },
  resolvedAt: DataTypes.DATE,
});

const Attachment = sequelize.define('Attachment', {
  originalName: DataTypes.STRING,
  fileName: DataTypes.STRING,
  mime: DataTypes.STRING,
  size: DataTypes.INTEGER,
  clientVisible: { type: DataTypes.BOOLEAN, defaultValue: false },
  forReview: { type: DataTypes.BOOLEAN, defaultValue: true }, // false for images pasted into comments
  reviewStatus: { type: DataTypes.STRING, defaultValue: 'pending' }, // team review: pending | approved | changes
  clientReviewStatus: { type: DataTypes.STRING, defaultValue: 'none' }, // none | requested | approved | changes
  clientReviewedAt: DataTypes.DATE,
  originalSize: DataTypes.INTEGER, // bytes before compression
  compression: { type: DataTypes.STRING, defaultValue: 'none' }, // none | pending | done | skipped | failed
});

const TimeLog = sequelize.define('TimeLog', {
  startedAt: { type: DataTypes.DATE, allowNull: false },
  endedAt: DataTypes.DATE,
  minutes: { type: DataTypes.INTEGER, defaultValue: 0 },
  note: DataTypes.STRING,
});

const Activity = sequelize.define('Activity', {
  action: { type: DataTypes.STRING, allowNull: false },
  summary: DataTypes.STRING,
  meta: json('meta', {}),
  clientVisible: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Notification = sequelize.define('Notification', {
  type: DataTypes.STRING,
  title: DataTypes.STRING,
  body: DataTypes.TEXT,
  link: DataTypes.STRING,
  read: { type: DataTypes.BOOLEAN, defaultValue: false },
  whatsappStatus: { type: DataTypes.STRING, defaultValue: 'skipped' }, // skipped | sent | failed | queued
});

const WhatsAppLog = sequelize.define('WhatsAppLog', {
  to: DataTypes.STRING,
  message: DataTypes.TEXT,
  status: DataTypes.STRING,
  provider: DataTypes.STRING,
  error: DataTypes.TEXT,
});

const ClientRequest = sequelize.define('ClientRequest', {
  title: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  priority: { type: DataTypes.STRING, defaultValue: 'medium' },
  status: { type: DataTypes.STRING, defaultValue: 'open' }, // open | accepted | declined | done
  response: DataTypes.TEXT,
});

// ---------- v2: planning ----------
const Section = sequelize.define('Section', {
  name: { type: DataTypes.STRING, allowNull: false },
  color: { type: DataTypes.STRING, defaultValue: '#5E6787' },
  order: { type: DataTypes.INTEGER, defaultValue: 0 },
});

const Sprint = sequelize.define('Sprint', {
  name: { type: DataTypes.STRING, allowNull: false },
  goal: DataTypes.TEXT,
  startDate: DataTypes.DATEONLY,
  endDate: DataTypes.DATEONLY,
  status: { type: DataTypes.STRING, defaultValue: 'planned' }, // planned | active | completed
  completedAt: DataTypes.DATE,
  snapshot: json('snapshot', null), // stats captured on completion
});

const TaskDependency = sequelize.define('TaskDependency', {}); // taskId is blocked by blockerId
const TaskWatcher = sequelize.define('TaskWatcher', {});
const TaskReviewer = sequelize.define('TaskReviewer', {}); // people who approve the task when it reaches review

// Browser push subscriptions (Web Push), one per browser per user.
const PushSubscription = sequelize.define('PushSubscription', {
  endpoint: { type: DataTypes.STRING(700), allowNull: false },
  keys: json('keys', {}),
  userAgent: DataTypes.STRING,
  lastUsedAt: DataTypes.DATE,
});

// ---------- v2: collaboration ----------
const Channel = sequelize.define('Channel', {
  name: DataTypes.STRING,
  description: DataTypes.STRING,
  kind: { type: DataTypes.STRING, defaultValue: 'channel' }, // channel | dm
  isPrivate: { type: DataTypes.BOOLEAN, defaultValue: false },
  dmKey: { type: DataTypes.STRING, unique: true }, // "3:7" for DMs
  lastMessageAt: DataTypes.DATE,
});
const ChannelMember = sequelize.define('ChannelMember', {
  lastReadAt: DataTypes.DATE,
});
const Message = sequelize.define('Message', {
  body: { type: DataTypes.TEXT, allowNull: false },
  mentions: json('mentions', []),
  editedAt: DataTypes.DATE,
});

const Meeting = sequelize.define('Meeting', {
  title: { type: DataTypes.STRING, allowNull: false },
  agenda: DataTypes.TEXT,
  startAt: { type: DataTypes.DATE, allowNull: false },
  endAt: { type: DataTypes.DATE, allowNull: false },
  link: DataTypes.STRING, // Google Meet / Zoom URL
  location: DataTypes.STRING,
  notes: DataTypes.TEXT,
  aiSummary: json('aiSummary', null),
  reminderSentAt: DataTypes.DATE,
  inviteClient: { type: DataTypes.BOOLEAN, defaultValue: false },
  provider: { type: DataTypes.STRING, defaultValue: 'link' }, // link | zoom
  zoomId: DataTypes.STRING,
  zoomPassword: DataTypes.STRING,
  guestEmails: json('guestEmails', []),
  emailedAt: DataTypes.DATE,
});
const MeetingAttendee = sequelize.define('MeetingAttendee', {
  response: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending | yes | no | maybe
});

const Document = sequelize.define('Document', {
  title: { type: DataTypes.STRING, allowNull: false },
  content: DataTypes.TEXT, // markdown
  icon: DataTypes.STRING,
  visibility: { type: DataTypes.STRING, defaultValue: 'workspace' }, // private | workspace
  clientVisible: { type: DataTypes.BOOLEAN, defaultValue: false },
  pinned: { type: DataTypes.BOOLEAN, defaultValue: false },
});

// ---------- v2: people ----------
const Attendance = sequelize.define('Attendance', {
  date: { type: DataTypes.DATEONLY, allowNull: false },
  inAt: DataTypes.DATE,
  outAt: DataTypes.DATE,
  sessionAt: DataTypes.DATE, // start of the current punch-in session (several per day allowed)
  minutes: { type: DataTypes.INTEGER, defaultValue: 0 },
  status: { type: DataTypes.STRING, defaultValue: 'present' }, // present | late | half_day | absent | remote | leave
  mode: { type: DataTypes.STRING, defaultValue: 'office' }, // office | remote
  note: DataTypes.STRING,
});

const PointEntry = sequelize.define('PointEntry', {
  points: { type: DataTypes.INTEGER, allowNull: false },
  reason: DataTypes.STRING,
  kind: DataTypes.STRING, // task_done | on_time | early | attendance | streak | bonus | badge
  refId: DataTypes.INTEGER,
});
const UserBadge = sequelize.define('UserBadge', {
  code: { type: DataTypes.STRING, allowNull: false },
});

// ---------- v2: tools ----------
const Automation = sequelize.define('Automation', {
  name: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  trigger: { type: DataTypes.STRING, allowNull: false }, // task.created | task.status | task.priority | task.assigned | task.overdue | task.comment
  conditions: json('conditions', {}), // { status, fromStatus, priority, projectId }
  actions: json('actions', []), // [{ type: notify|whatsapp|set_status|set_priority|assign|comment|points|move_section, ... }]
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  runs: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastRunAt: DataTypes.DATE,
});

const Template = sequelize.define('Template', {
  name: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  category: { type: DataTypes.STRING, defaultValue: 'General' },
  icon: { type: DataTypes.STRING, defaultValue: '📦' },
  structure: json('structure', { sections: [], milestones: [], tasks: [] }),
  uses: { type: DataTypes.INTEGER, defaultValue: 0 },
  isSystem: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const AiInsight = sequelize.define('AiInsight', {
  kind: { type: DataTypes.STRING, allowNull: false }, // brief | standup | report | health
  scope: DataTypes.STRING,
  content: json('content', null),
  source: { type: DataTypes.STRING, defaultValue: 'gemini' }, // gemini | rules
});

const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING, unique: true },
  value: json('value', null),
});

// ---------- Associations ----------
Role.hasMany(User, { foreignKey: 'roleId' });
User.belongsTo(Role, { foreignKey: 'roleId' });

User.belongsTo(User, { as: 'manager', foreignKey: 'reportsToId' });
User.hasMany(User, { as: 'reports', foreignKey: 'reportsToId' });

Client.hasMany(User, { as: 'portalUsers', foreignKey: 'clientId' });
User.belongsTo(Client, { foreignKey: 'clientId' });

Client.hasMany(Project, { foreignKey: 'clientId' });
Project.belongsTo(Client, { foreignKey: 'clientId' });
Project.belongsTo(User, { as: 'owner', foreignKey: 'ownerId' });

Project.belongsToMany(User, { through: ProjectMember, as: 'members', foreignKey: 'projectId', otherKey: 'userId' });
User.belongsToMany(Project, { through: ProjectMember, as: 'projects', foreignKey: 'userId', otherKey: 'projectId' });

Project.hasMany(Milestone, { foreignKey: 'projectId', onDelete: 'CASCADE' });
Milestone.belongsTo(Project, { foreignKey: 'projectId' });

Project.hasMany(Task, { foreignKey: 'projectId' });
Task.belongsTo(Project, { foreignKey: 'projectId' });
Task.belongsTo(Milestone, { foreignKey: 'milestoneId' });

Task.hasMany(Task, { as: 'subtasks', foreignKey: 'parentId', onDelete: 'CASCADE' });
Task.belongsTo(Task, { as: 'parent', foreignKey: 'parentId' });
Task.belongsTo(User, { as: 'creator', foreignKey: 'createdById' });

Task.belongsToMany(User, { through: TaskAssignee, as: 'assignees', foreignKey: 'taskId', otherKey: 'userId' });
User.belongsToMany(Task, { through: TaskAssignee, as: 'assignedTasks', foreignKey: 'userId', otherKey: 'taskId' });

Task.hasMany(ChecklistItem, { as: 'checklist', foreignKey: 'taskId', onDelete: 'CASCADE' });
Task.hasMany(Comment, { foreignKey: 'taskId', onDelete: 'CASCADE' });
Comment.belongsTo(User, { as: 'author', foreignKey: 'userId' });
Task.hasMany(Attachment, { foreignKey: 'taskId', onDelete: 'CASCADE' });
Comment.hasMany(Attachment, { as: 'images', foreignKey: 'commentId' });
Comment.belongsTo(Attachment, { as: 'target', foreignKey: 'attachmentId', constraints: false });
Comment.belongsTo(User, { as: 'resolver', foreignKey: 'resolvedById', constraints: false });
Client.hasMany(ClientFile, { foreignKey: 'clientId', onDelete: 'CASCADE' });
ClientFile.belongsTo(User, { as: 'uploader', foreignKey: 'userId', constraints: false });
Attachment.belongsTo(User, { as: 'uploader', foreignKey: 'userId' });
Task.hasMany(TimeLog, { foreignKey: 'taskId', onDelete: 'CASCADE' });
TimeLog.belongsTo(User, { foreignKey: 'userId' });
TimeLog.belongsTo(Task, { foreignKey: 'taskId' });

Activity.belongsTo(User, { as: 'actor', foreignKey: 'actorId' });
Activity.belongsTo(Task, { foreignKey: 'taskId' });
Activity.belongsTo(Project, { foreignKey: 'projectId' });

Notification.belongsTo(User, { foreignKey: 'userId' });

ClientRequest.belongsTo(Client, { foreignKey: 'clientId' });
ClientRequest.belongsTo(Project, { foreignKey: 'projectId' });
ClientRequest.belongsTo(User, { as: 'requester', foreignKey: 'userId' });
ClientRequest.belongsTo(Task, { foreignKey: 'taskId' });

// ---------- v2 associations ----------
Project.hasMany(Section, { foreignKey: 'projectId', onDelete: 'CASCADE' });
Section.belongsTo(Project, { foreignKey: 'projectId' });
Task.belongsTo(Section, { foreignKey: 'sectionId' });

Project.hasMany(Sprint, { foreignKey: 'projectId', onDelete: 'CASCADE' });
Sprint.belongsTo(Project, { foreignKey: 'projectId' });
Task.belongsTo(Sprint, { foreignKey: 'sprintId' });
Sprint.hasMany(Task, { foreignKey: 'sprintId' });

Task.belongsToMany(Task, { through: TaskDependency, as: 'blockers', foreignKey: 'taskId', otherKey: 'blockerId' });
Task.belongsToMany(Task, { through: TaskDependency, as: 'blocking', foreignKey: 'blockerId', otherKey: 'taskId' });
Task.belongsToMany(User, { through: TaskWatcher, as: 'watchers', foreignKey: 'taskId', otherKey: 'userId' });
Task.belongsToMany(User, { through: TaskReviewer, as: 'reviewers', foreignKey: 'taskId', otherKey: 'userId' });
PushSubscription.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(PushSubscription, { foreignKey: 'userId' });

Channel.belongsToMany(User, { through: ChannelMember, as: 'members', foreignKey: 'channelId', otherKey: 'userId' });
User.belongsToMany(Channel, { through: ChannelMember, as: 'channels', foreignKey: 'userId', otherKey: 'channelId' });
Channel.hasMany(ChannelMember, { foreignKey: 'channelId' });
ChannelMember.belongsTo(User, { foreignKey: 'userId' });
Channel.belongsTo(Project, { foreignKey: 'projectId' });
Channel.belongsTo(User, { as: 'creator', foreignKey: 'createdById' });
Channel.hasMany(Message, { foreignKey: 'channelId', onDelete: 'CASCADE' });
Message.belongsTo(Channel, { foreignKey: 'channelId' });
Message.belongsTo(User, { as: 'author', foreignKey: 'userId' });
Message.belongsTo(Task, { foreignKey: 'taskId' });

Meeting.belongsTo(User, { as: 'organizer', foreignKey: 'organizerId' });
Meeting.belongsTo(Project, { foreignKey: 'projectId' });
Meeting.belongsTo(Client, { foreignKey: 'clientId' });
Meeting.belongsToMany(User, { through: MeetingAttendee, as: 'attendees', foreignKey: 'meetingId', otherKey: 'userId' });

Document.belongsTo(User, { as: 'author', foreignKey: 'createdById' });
Document.belongsTo(User, { as: 'editor', foreignKey: 'updatedById' });
Document.belongsTo(Project, { foreignKey: 'projectId' });
Project.hasMany(Document, { foreignKey: 'projectId' });

Attendance.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Attendance, { foreignKey: 'userId' });
PointEntry.belongsTo(User, { foreignKey: 'userId' });
UserBadge.belongsTo(User, { foreignKey: 'userId' });

Automation.belongsTo(User, { as: 'creator', foreignKey: 'createdById' });
Template.belongsTo(User, { as: 'creator', foreignKey: 'createdById' });
AiInsight.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  Section, Sprint, TaskDependency, TaskWatcher, TaskReviewer, PushSubscription, Channel, ChannelMember, Message, Meeting, MeetingAttendee, Document,
  Attendance, PointEntry, UserBadge, Automation, Template, AiInsight, ClientFile,
  sequelize, Role, Client, User, Project, ProjectMember, Milestone, Task, TaskAssignee,
  ChecklistItem, Comment, Attachment, TimeLog, Activity, Notification, WhatsAppLog, ClientRequest, Setting,
};
