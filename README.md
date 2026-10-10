# Orbit — team task management for Corcus Studio

Node.js (Express + Sequelize + Socket.IO) API and a React (Vite + Tailwind) app with:

- **Roles you create yourself** — Admin builds any hierarchy (Manager, Team Lead, Executive, Intern…) with a level number and a permission checklist. People can only manage roles below their own level.
- **Reporting lines** — everyone can have a "reports to". Managers automatically see and edit the work of everyone under them, at any depth. Org chart view on the Team page.
- **Multi-level tasks** — tasks → subtasks → sub-subtasks (up to 7 levels). Progress rolls up from the deepest tasks. Each level can have different assignees.
- **Multiple assignees per task**, checklists, comments with @mentions, file attachments, time tracking (timer + manual log), priorities, start/due dates, tags, milestones.
- **Approval flow** — mark a task as "needs approval": done → review → approved / changes requested (nobody can approve their own work).
- **Views** — dashboard (personal + team health, workload, trend), list with expandable trees, drag-and-drop board, calendar, activity feed, global search (Ctrl K).
- **Client portal** — clients sign in to the same URL and only see their projects, the tasks you mark "Show in client portal", shared comments and files. They can approve deliverables, ask for changes, message the team and raise requests (which you convert into tasks).
- **WhatsApp notifications** — every person has a WhatsApp number. Alerts for assignments, status changes, comments/mentions, due-in-24h reminders, daily overdue nudges (to the person and their manager), approvals, client updates and client requests. Each person can switch alert types off.
- **Realtime** — boards, tasks and notifications update live across everyone's screens.

## Run locally

```bash
npm run install:all
cp server/.env.example server/.env      # edit JWT_SECRET
npm run seed:demo                        # optional demo workspace
npm run dev:server                       # API on :5000
npm run dev:client                       # app on :5173
```

Demo logins (password `Orbit@123`): `admin@corcus.in`, `manager@corcus.in`, `lead@corcus.in`, `rahul@corcus.in`, client portal `client@kasaar.in`.

Without the demo seed, open the app and the first screen creates your company and first admin.

Tests: with the server running on a demo database, `npm test` runs 36 end-to-end API checks (permissions, hierarchy visibility, subtasks, approvals, portal isolation, WhatsApp).

## Deploy (Hostinger Node.js app)

1. hPanel → Databases → MySQL: create a database and user.
2. hPanel → Websites → Add website → Node.js app → upload this zip (or connect GitHub).
3. Build settings: Node 20, build command `npm run build`, start command `npm start`, entry file `server/src/index.js`.
4. Environment variables (or a `server/.env` file): `NODE_ENV=production`, `JWT_SECRET` (long random), `APP_URL=https://tasks.yourdomain.com`, `CORS_ORIGIN` (same URL), `DB_DIALECT=mysql`, `DB_HOST`, `DB_PORT=3306`, `DB_NAME`, `DB_USER`, `DB_PASS`.
5. Deploy, attach your (sub)domain, enable SSL. Open the site: the first screen creates your company and admin.

Tables are created on first start. After future model changes, start once with `DB_ALTER=1`.
`server/uploads/` holds attachments — keep it on persistent storage.

### On a VPS instead

```bash
git clone … orbit && cd orbit && npm run build
cp server/.env.example server/.env   # fill in MySQL + JWT_SECRET + APP_URL
npm i -g pm2 && pm2 start server/src/index.js --name orbit && pm2 save && pm2 startup
```
Put Nginx in front (proxy to port 5000, with `Upgrade`/`Connection` headers for Socket.IO) and run Certbot for SSL.

## WhatsApp setup (Settings → WhatsApp)

- **Log only** — nothing is sent; messages show in the log. Use this to test.
- **WhatsApp Cloud API (Meta)** — paste the permanent token and phone number ID. Business-started messages must use an approved template with **one body variable** `{{1}}`, e.g. template `task_update`, body: `{{1}}`. Plain-text mode only reaches people who messaged your number in the last 24 hours.
- **My WhatsApp API** — any panel/BSP with an HTTP send endpoint (your white-label panel, Interakt, WATI, AiSensy…). Set URL, headers and a JSON body using `{{phone}}` and `{{message}}`.

Numbers are normalised to international format (10-digit numbers get the default country code, 91).

## Project layout

```
server/src
  index.js              Express + Socket.IO + static app
  models/index.js       all tables and relations
  config/permissions.js permission list and default roles
  routes/               auth, roles, users, clients, projects, tasks, dashboard, portal, misc
  services/             access rules, progress roll-up, notifications, WhatsApp, settings, sockets
  jobs/reminders.js     due-soon (every 15 min) and overdue (daily 10:05 IST)
client/src
  pages/                staff screens
  portal/               client portal
  components/           layout, task views, forms, UI kit (OrbitRing etc.)
```

## Adding more companies later

Everything is single-company now. To go multi-company, add a `companyId` column to every table, put it in the JWT, and add it to every query's `where` (the access helpers in `services/access.js` are the natural place).
