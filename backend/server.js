const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3001;
const JWT_SECRET = 'task-tracker-secret-key-2024';
const DB_PATH = path.join(__dirname, 'data', 'tracker.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let db;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx', '.xlsx', '.pptx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function run(sql, params = []) {
  db.run(sql, params);
}

function runSave(sql, params = []) {
  db.run(sql, params);
  const id = lastInsertId();
  saveDB();
  return id;
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    stmt.free();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    results.push(row);
  }
  stmt.free();
  return results;
}

function lastInsertId() {
  const stmt = db.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const id = stmt.get()[0];
  stmt.free();
  return id;
}

function initDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      position TEXT,
      role TEXT NOT NULL DEFAULT 'employee',
      avatar_url TEXT,
      timezone TEXT DEFAULT 'Europe/Moscow',
      is_active INTEGER DEFAULT 1,
      is_first_login INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      code TEXT NOT NULL UNIQUE,
      lead_id INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'planned',
      start_date TEXT,
      planned_end_date TEXT,
      allow_members_create_tasks INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      user_id INTEGER,
      UNIQUE(project_id, user_id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'backlog',
      priority TEXT DEFAULT 'medium',
      assignee_id INTEGER,
      reporter_id INTEGER,
      deadline TEXT,
      sort_order INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      task_code TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      user_id INTEGER,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      user_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      task_id INTEGER,
      project_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE TABLE IF NOT EXISTS task_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, tag TEXT NOT NULL)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      user_id INTEGER,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE TABLE IF NOT EXISTS task_order (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, project_id INTEGER, status TEXT NOT NULL, sort_order INTEGER DEFAULT 0, UNIQUE(task_id, project_id))`);
}

function generateTaskCode(projectCode, taskId) {
  return `${projectCode}${String(taskId).padStart(3, '0')}`;
}

function createNotification(userId, type, title, message, taskId, projectId) {
  run(`INSERT INTO notifications (user_id, type, title, message, task_id, project_id) VALUES (?, ?, ?, ?, ?, ?)`, [userId, type, title, message || null, taskId || null, projectId || null]);
}

function logTaskHistory(taskId, userId, field, oldValue, newValue) {
  if (String(oldValue) !== String(newValue)) {
    run(`INSERT INTO task_history (task_id, user_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)`, [taskId, userId, field, String(oldValue || ''), String(newValue || '')]);
  }
}

function getNextTaskSortOrder(projectId, status) {
  const row = get(`SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM task_order WHERE project_id = ? AND status = ?`, [projectId, status]);
  return row ? row.next_order : 0;
}

// ========== AUTH MIDDLEWARE ==========
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = get('SELECT id, email, first_name, last_name, role, is_active, is_first_login FROM users WHERE id = ?', [decoded.userId]);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Пользователь не найден или деактивирован' });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

// ========== LOGIN ATTEMPTS ==========
const loginAttempts = {};
function checkLoginAttempts(email) {
  const key = email.toLowerCase();
  const now = Date.now();
  if (!loginAttempts[key]) return { blocked: false };
  loginAttempts[key] = loginAttempts[key].filter(t => now - t < 15 * 60 * 1000);
  if (loginAttempts[key].length >= 10) return { blocked: true, remaining: Math.ceil((loginAttempts[key][0] + 15 * 60 * 1000 - now) / 60000) };
  return { blocked: false };
}
function recordLoginAttempt(email) {
  const key = email.toLowerCase();
  if (!loginAttempts[key]) loginAttempts[key] = [];
  loginAttempts[key].push(Date.now());
}
function clearLoginAttempts(email) { delete loginAttempts[email.toLowerCase()]; }

// ========== AUTH ROUTES ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
    const attemptCheck = checkLoginAttempts(email);
    if (attemptCheck.blocked) return res.status(429).json({ error: `Аккаунт заблокирован на ${attemptCheck.remaining} минут` });
    const user = get('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      recordLoginAttempt(email);
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    clearLoginAttempts(email);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, ...userData } = user;
    res.json({ token, user: userData });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) return res.status(400).json({ error: 'Неверный текущий пароль' });
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword))
      return res.status(400).json({ error: 'Пароль: минимум 8 символов, хотя бы одна буква и одна цифра' });
    run('UPDATE users SET password_hash = ?, is_first_login = 0, updated_at = datetime(\'now\') WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.user.id]);
    res.json({ message: 'Пароль успешно изменён' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  try {
    const user = get('SELECT id, email, first_name, last_name, position, role, avatar_url, timezone, is_first_login, created_at FROM users WHERE id = ?', [req.user.id]);
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== USERS ==========
app.get('/api/users', authMiddleware, (req, res) => {
  try {
    const users = all(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.position, u.role, u.avatar_url, u.is_active, u.created_at,
        (SELECT COUNT(*) FROM tasks WHERE assignee_id = u.id AND status NOT IN ('done') AND is_deleted = 0) as active_tasks,
        (SELECT COUNT(*) FROM tasks WHERE assignee_id = u.id AND status NOT IN ('done') AND is_deleted = 0 AND deadline IS NOT NULL AND deadline < datetime('now')) as overdue_tasks
      FROM users u WHERE u.is_active = 1 ORDER BY u.last_name, u.first_name
    `);
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id', authMiddleware, (req, res) => {
  try {
    const user = get('SELECT id, email, first_name, last_name, position, role, avatar_url, timezone, created_at FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const tasks = all('SELECT t.*, p.name as project_name, p.code as project_code FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.assignee_id = ? AND t.is_deleted = 0 ORDER BY t.created_at DESC', [req.params.id]);
    res.json({ ...user, tasks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', authMiddleware, adminOnly, (req, res) => {
  try {
    const { email, first_name, last_name, position, role } = req.body;
    if (!email || !first_name || !last_name || !role) return res.status(400).json({ error: 'Обязательные поля: email, first_name, last_name, role' });
    const existing = get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    const tempPassword = 'Temp' + Math.random().toString(36).slice(-8) + '1';
    const hash = bcrypt.hashSync(tempPassword, 10);
    run('INSERT INTO users (email, password_hash, first_name, last_name, position, role, is_first_login) VALUES (?, ?, ?, ?, ?, ?, 1)', [email, hash, first_name, last_name, position || null, role]);
    const id = lastInsertId();
    res.status(201).json({ id, tempPassword, email, first_name, last_name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', authMiddleware, (req, res) => {
  try {
    const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id)) return res.status(403).json({ error: 'Доступ запрещён' });
    const { first_name, last_name, position, role, timezone, avatar_url } = req.body;
    if (req.user.role !== 'admin' && role) return res.status(403).json({ error: 'Только администратор может менять роль' });
    run(`UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), position = COALESCE(?, position), role = COALESCE(?, role), timezone = COALESCE(?, timezone), avatar_url = COALESCE(?, avatar_url), updated_at = datetime('now') WHERE id = ?`,
      [first_name || null, last_name || null, position || null, role || null, timezone || null, avatar_url || null, req.params.id]);
    const updated = get('SELECT id, email, first_name, last_name, position, role, avatar_url, timezone FROM users WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:id/reset-password', authMiddleware, adminOnly, (req, res) => {
  try {
    const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const tempPassword = 'Temp' + Math.random().toString(36).slice(-8) + '1';
    run('UPDATE users SET password_hash = ?, is_first_login = 1, updated_at = datetime(\'now\') WHERE id = ?', [bcrypt.hashSync(tempPassword, 10), req.params.id]);
    res.json({ tempPassword, message: 'Пароль сброшен.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:id/deactivate', authMiddleware, adminOnly, (req, res) => {
  try {
    run('UPDATE users SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?', [req.params.id]);
    res.json({ message: 'Пользователь деактивирован' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== PROJECTS ==========
app.get('/api/projects', authMiddleware, (req, res) => {
  try {
    let projects;
    if (req.user.role === 'admin') {
      projects = all(`SELECT p.*, u.first_name || ' ' || u.last_name as lead_name,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND is_deleted = 0) as total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND is_deleted = 0 AND status = 'done') as done_tasks
        FROM projects p LEFT JOIN users u ON p.lead_id = u.id ORDER BY p.created_at DESC`);
    } else if (req.user.role === 'project_manager') {
      projects = all(`SELECT p.*, u.first_name || ' ' || u.last_name as lead_name,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND is_deleted = 0) as total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND is_deleted = 0 AND status = 'done') as done_tasks
        FROM projects p LEFT JOIN users u ON p.lead_id = u.id
        WHERE p.lead_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
        ORDER BY p.created_at DESC`, [req.user.id, req.user.id]);
    } else {
      projects = all(`SELECT p.*, u.first_name || ' ' || u.last_name as lead_name,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND is_deleted = 0) as total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND is_deleted = 0 AND status = 'done') as done_tasks
        FROM projects p LEFT JOIN users u ON p.lead_id = u.id
        WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
        ORDER BY p.created_at DESC`, [req.user.id]);
    }
    res.json(projects);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/projects/:id', authMiddleware, (req, res) => {
  try {
    const project = get('SELECT p.*, u.first_name || \' \' || u.last_name as lead_name FROM projects p LEFT JOIN users u ON p.lead_id = u.id WHERE p.id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    const members = all('SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.position FROM users u JOIN project_members pm ON u.id = pm.user_id WHERE pm.project_id = ?', [req.params.id]);
    const taskStats = all('SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? AND is_deleted = 0 GROUP BY status', [req.params.id]);
    res.json({ ...project, members, taskStats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects', authMiddleware, adminOnly, (req, res) => {
  try {
    const { name, description, code, lead_id, start_date, planned_end_date, allow_members_create_tasks } = req.body;
    if (!name || !code || !lead_id) return res.status(400).json({ error: 'Обязательные поля: name, code, lead_id' });
    const existing = get('SELECT id FROM projects WHERE code = ?', [code.toUpperCase()]);
    if (existing) return res.status(400).json({ error: 'Проект с таким кодом уже существует' });
    run('INSERT INTO projects (name, description, code, lead_id, start_date, planned_end_date, allow_members_create_tasks) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, description || null, code.toUpperCase(), lead_id, start_date || null, planned_end_date || null, allow_members_create_tasks ? 1 : 0]);
    const id = lastInsertId();
    run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [id, lead_id]);
    const project = get('SELECT * FROM projects WHERE id = ?', [id]);
    res.status(201).json(project);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:id', authMiddleware, (req, res) => {
  try {
    const project = get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (req.user.role !== 'admin' && project.lead_id !== req.user.id) return res.status(403).json({ error: 'Доступ запрещён' });
    const { name, description, lead_id, status, start_date, planned_end_date, allow_members_create_tasks } = req.body;
    run(`UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), lead_id = COALESCE(?, lead_id), status = COALESCE(?, status), start_date = COALESCE(?, start_date), planned_end_date = COALESCE(?, planned_end_date), allow_members_create_tasks = COALESCE(?, allow_members_create_tasks), updated_at = datetime('now') WHERE id = ?`,
      [name || null, description || null, lead_id || null, status || null, start_date || null, planned_end_date || null, allow_members_create_tasks !== undefined ? (allow_members_create_tasks ? 1 : 0) : null, req.params.id]);
    const updated = get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:id/archive', authMiddleware, (req, res) => {
  try {
    const project = get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (req.user.role !== 'admin' && project.lead_id !== req.user.id) return res.status(403).json({ error: 'Доступ запрещён' });
    run("UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
    res.json({ message: 'Проект архивирован' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:id/members', authMiddleware, (req, res) => {
  try {
    const { user_id } = req.body;
    const project = get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (req.user.role !== 'admin' && project.lead_id !== req.user.id) return res.status(403).json({ error: 'Доступ запрещён' });
    try { run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [req.params.id, user_id]); } catch (e) {}
    res.json({ message: 'Участник добавлен' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:id/members/:userId', authMiddleware, (req, res) => {
  try {
    const project = get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (req.user.role !== 'admin' && project.lead_id !== req.user.id) return res.status(403).json({ error: 'Доступ запрещён' });
    run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
    res.json({ message: 'Участник удалён' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== TASKS ==========
app.get('/api/tasks/my', authMiddleware, (req, res) => {
  try {
    const tasks = all(`SELECT t.*, p.name as project_name, p.code as project_code,
      u.first_name || ' ' || u.last_name as assignee_name, u.avatar_url as assignee_avatar
      FROM tasks t JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.assignee_id = ? AND t.is_deleted = 0 ORDER BY t.created_at DESC`, [req.user.id]);
    res.json(tasks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tasks', authMiddleware, (req, res) => {
  try {
    const { project_id, status, priority, assignee_id, search, overdue } = req.query;
    let query = `SELECT t.*, p.name as project_name, p.code as project_code,
      u.first_name || ' ' || u.last_name as assignee_name, u.avatar_url as assignee_avatar,
      r.first_name || ' ' || r.last_name as reporter_name
      FROM tasks t JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id LEFT JOIN users r ON t.reporter_id = r.id
      WHERE t.is_deleted = 0`;
    const params = [];

    if (req.user.role === 'employee') {
      query += ` AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)`;
      params.push(req.user.id);
    } else if (req.user.role === 'project_manager') {
      query += ` AND (t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?) OR t.project_id IN (SELECT id FROM projects WHERE lead_id = ?))`;
      params.push(req.user.id, req.user.id);
    }

    if (project_id) { query += ` AND t.project_id = ?`; params.push(project_id); }
    if (status) { query += ` AND t.status = ?`; params.push(status); }
    if (priority) { query += ` AND t.priority = ?`; params.push(priority); }
    if (assignee_id) { query += ` AND t.assignee_id = ?`; params.push(assignee_id); }
    if (search) { query += ` AND (t.title LIKE ? OR t.task_code LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
    if (overdue === 'true') { query += ` AND t.deadline < datetime('now') AND t.status != 'done'`; }

    query += ` ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, COALESCE(t.deadline, '9999-12-31') ASC, t.updated_at DESC`;

    const tasks = all(query, params);
    res.json(tasks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tasks/:id', authMiddleware, (req, res) => {
  try {
    const task = get(`SELECT t.*, p.name as project_name, p.code as project_code,
      u.first_name || ' ' || u.last_name as assignee_name, u.avatar_url as assignee_avatar, u.email as assignee_email,
      r.first_name || ' ' || r.last_name as reporter_name, r.avatar_url as reporter_avatar
      FROM tasks t JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id LEFT JOIN users r ON t.reporter_id = r.id
      WHERE t.id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });
    const comments = all(`SELECT c.*, u.first_name || ' ' || u.last_name as author_name, u.avatar_url as author_avatar
      FROM comments c JOIN users u ON c.user_id = u.id WHERE c.task_id = ? ORDER BY c.created_at ASC`, [req.params.id]);
    const attachments = all(`SELECT a.*, u.first_name || ' ' || u.last_name as author_name
      FROM attachments a JOIN users u ON a.user_id = u.id WHERE a.task_id = ? ORDER BY a.created_at DESC`, [req.params.id]);
    const history = all(`SELECT h.*, u.first_name || ' ' || u.last_name as user_name
      FROM task_history h LEFT JOIN users u ON h.user_id = u.id WHERE h.task_id = ? ORDER BY h.created_at DESC`, [req.params.id]);
    const tags = all('SELECT tag FROM task_tags WHERE task_id = ?', [req.params.id]).map(r => r.tag);
    res.json({ ...task, comments, attachments, history, tags });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks', authMiddleware, (req, res) => {
  try {
    const { project_id, title, description, status, priority, assignee_id, deadline, tags } = req.body;
    if (!project_id || !title) return res.status(400).json({ error: 'Обязательные поля: project_id, title' });
    const project = get('SELECT * FROM projects WHERE id = ?', [project_id]);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    if (req.user.role === 'employee') {
      if (!project.allow_members_create_tasks) return res.status(403).json({ error: 'Сотрудники не могут создавать задачи в этом проекте' });
      const isMember = get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', [project_id, req.user.id]);
      if (!isMember) return res.status(403).json({ error: 'Вы не участник этого проекта' });
    }

    const taskStatus = status || 'backlog';
    const sortOrder = getNextTaskSortOrder(project_id, taskStatus);
    run('INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, reporter_id, deadline, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [project_id, title, description || null, taskStatus, priority || 'medium', assignee_id || null, req.user.id, deadline || null, sortOrder]);
    const id = lastInsertId();
    const taskCode = generateTaskCode(project.code, id);
    run('UPDATE tasks SET task_code = ? WHERE id = ?', [taskCode, id]);
    run('INSERT INTO task_order (task_id, project_id, status, sort_order) VALUES (?, ?, ?, ?)', [id, project_id, taskStatus, sortOrder]);

    if (tags && tags.length) {
      const tagStmt = db.prepare('INSERT INTO task_tags (task_id, tag) VALUES (?, ?)');
      tags.forEach(tag => { tagStmt.run([id, tag]); });
      tagStmt.free();
    }

    if (assignee_id) createNotification(assignee_id, 'task_assigned', 'Назначена задача', `Вам назначена задача ${taskCode}: ${title}`, id, project_id);
    logTaskHistory(id, req.user.id, 'created', null, title);
    saveDB();

    const task = get('SELECT * FROM tasks WHERE id = ?', [id]);
    res.status(201).json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/tasks/:id', authMiddleware, (req, res) => {
  try {
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });
    const { title, description, status, priority, assignee_id, deadline, tags } = req.body;

    if (status !== undefined && status !== task.status) {
      logTaskHistory(task.id, req.user.id, 'status', task.status, status);
      const nextOrder = getNextTaskSortOrder(task.project_id, status);
      run('UPDATE task_order SET status = ?, sort_order = ? WHERE task_id = ? AND project_id = ?', [status, nextOrder, task.id, task.project_id]);
      if (assignee_id || task.assignee_id) {
        const notifyUser = assignee_id || task.assignee_id;
        createNotification(notifyUser, 'status_changed', 'Изменён статус', `Задача ${task.task_code}: статус → "${status}"`, task.id, task.project_id);
      }
    }
    if (priority !== undefined && priority !== task.priority) logTaskHistory(task.id, req.user.id, 'priority', task.priority, priority);
    if (assignee_id !== undefined && assignee_id !== task.assignee_id) {
      logTaskHistory(task.id, req.user.id, 'assignee', task.assignee_id, assignee_id);
      if (assignee_id) createNotification(assignee_id, 'task_assigned', 'Назначена задача', `Вам назначена задача ${task.task_code}`, task.id, task.project_id);
    }
    if (deadline !== undefined && deadline !== task.deadline) logTaskHistory(task.id, req.user.id, 'deadline', task.deadline, deadline);
    if (title !== undefined && title !== task.title) logTaskHistory(task.id, req.user.id, 'title', task.title, title);
    if (description !== undefined && description !== task.description) logTaskHistory(task.id, req.user.id, 'description', task.description, description);

    run(`UPDATE tasks SET title = COALESCE(?, title), description = COALESCE(?, description), status = COALESCE(?, status), priority = COALESCE(?, priority), assignee_id = COALESCE(?, assignee_id), deadline = COALESCE(?, deadline), updated_at = datetime('now') WHERE id = ?`,
      [title || null, description !== undefined ? description : null, status || null, priority || null, assignee_id || null, deadline || null, req.params.id]);

    if (tags !== undefined) {
      run('DELETE FROM task_tags WHERE task_id = ?', [req.params.id]);
      if (tags && tags.length) {
        const tagStmt = db.prepare('INSERT INTO task_tags (task_id, tag) VALUES (?, ?)');
        tags.forEach(tag => { tagStmt.run([req.params.id, tag]); });
        tagStmt.free();
      }
    }

    const updated = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/tasks/:id/order', authMiddleware, (req, res) => {
  try {
    const { status, sort_order } = req.body;
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });
    run("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, req.params.id]);
    const existing = get('SELECT * FROM task_order WHERE task_id = ? AND project_id = ?', [req.params.id, task.project_id]);
    if (existing) {
      run('UPDATE task_order SET status = ?, sort_order = ? WHERE task_id = ? AND project_id = ?', [status, sort_order || 0, req.params.id, task.project_id]);
    } else {
      run('INSERT INTO task_order (task_id, project_id, status, sort_order) VALUES (?, ?, ?, ?)', [req.params.id, task.project_id, status, sort_order || 0]);
    }
    res.json({ message: 'Порядок обновлён' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tasks/:id', authMiddleware, (req, res) => {
  try {
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });
    run("UPDATE tasks SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?", [req.params.id]);
    res.json({ message: 'Задача перемещена в корзину (30 дней)' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks/:id/restore', authMiddleware, (req, res) => {
  try {
    run("UPDATE tasks SET is_deleted = 0, deleted_at = NULL WHERE id = ?", [req.params.id]);
    res.json({ message: 'Задача восстановлена' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== COMMENTS ==========
app.post('/api/tasks/:id/comments', authMiddleware, (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Комментарий не может быть пустым' });
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });
    run('INSERT INTO comments (task_id, user_id, content) VALUES (?, ?, ?)', [req.params.id, req.user.id, content]);
    const id = lastInsertId();
    if (task.assignee_id && task.assignee_id !== req.user.id) {
      createNotification(task.assignee_id, 'new_comment', 'Новый комментарий', `Комментарий к задаче ${task.task_code}`, task.id, task.project_id);
    }
    const comment = get(`SELECT c.*, u.first_name || ' ' || u.last_name as author_name, u.avatar_url as author_avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`, [id]);
    res.status(201).json(comment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/tasks/:id/comments/:commentId', authMiddleware, (req, res) => {
  try {
    const comment = get('SELECT * FROM comments WHERE id = ?', [req.params.commentId]);
    if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
    run("UPDATE comments SET content = ?, updated_at = datetime('now') WHERE id = ?", [req.body.content, req.params.commentId]);
    res.json({ message: 'Комментарий обновлён' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tasks/:id/comments/:commentId', authMiddleware, (req, res) => {
  try {
    const comment = get('SELECT * FROM comments WHERE id = ?', [req.params.commentId]);
    if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
    run('DELETE FROM comments WHERE id = ?', [req.params.commentId]);
    res.json({ message: 'Комментарий удалён' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== ATTACHMENTS ==========
app.post('/api/tasks/:id/attachments', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const task = get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });
    const totalSize = get('SELECT COALESCE(SUM(size), 0) as total FROM attachments WHERE task_id = ?', [req.params.id]);
    if (totalSize.total + req.file.size > 200 * 1024 * 1024) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Превышен лимит 200 МБ на задачу' });
    }
    run('INSERT INTO attachments (task_id, user_id, filename, original_name, mime_type, size) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, req.user.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size]);
    const id = lastInsertId();
    const attachment = get('SELECT * FROM attachments WHERE id = ?', [id]);
    res.status(201).json(attachment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/attachments/:id/download', authMiddleware, (req, res) => {
  try {
    const att = get('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'Вложение не найдено' });
    res.download(path.join(UPLOADS_DIR, att.filename), att.original_name);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/attachments/:id', authMiddleware, (req, res) => {
  try {
    const att = get('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'Вложение не найдено' });
    const task = get('SELECT * FROM tasks WHERE id = ?', [att.task_id]);
    if (att.user_id !== req.user.id && (!task || task.assignee_id !== req.user.id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
    const filePath = path.join(UPLOADS_DIR, att.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    run('DELETE FROM attachments WHERE id = ?', [req.params.id]);
    res.json({ message: 'Вложение удалено' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== NOTIFICATIONS ==========
app.get('/api/notifications', authMiddleware, (req, res) => {
  try { res.json(all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id])); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications/unread-count', authMiddleware, (req, res) => {
  try { const r = get('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]); res.json({ count: r.count }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notifications/:id/read', authMiddleware, (req, res) => {
  try { run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]); res.json({ message: 'OK' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notifications/read-all', authMiddleware, (req, res) => {
  try { run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]); res.json({ message: 'OK' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== SEARCH ==========
app.get('/api/search', authMiddleware, (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ projects: [], tasks: [], users: [] });
    const sp = `%${q}%`;
    const projects = all(`SELECT id, name, code, status FROM projects WHERE (name LIKE ? OR code LIKE ?) AND status != 'archived'`, [sp, sp]);
    let taskQuery = `SELECT t.id, t.title, t.task_code, t.status, t.priority, p.name as project_name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE (t.title LIKE ? OR t.task_code LIKE ?) AND t.is_deleted = 0`;
    const tp = [sp, sp];
    if (req.user.role === 'employee') { taskQuery += ` AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)`; tp.push(req.user.id); }
    const tasks = all(taskQuery, tp);
    const users = all(`SELECT id, first_name, last_name, email, position FROM users WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?) AND is_active = 1`, [sp, sp, sp]);
    res.json({ projects, tasks, users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== TEAM ==========
app.get('/api/team', authMiddleware, (req, res) => {
  try {
    res.json(all(`SELECT u.id, u.email, u.first_name, u.last_name, u.position, u.role, u.avatar_url, u.created_at,
      (SELECT COUNT(*) FROM tasks WHERE assignee_id = u.id AND status NOT IN ('done') AND is_deleted = 0) as active_tasks,
      (SELECT COUNT(*) FROM tasks WHERE assignee_id = u.id AND status NOT IN ('done') AND is_deleted = 0 AND deadline IS NOT NULL AND deadline < datetime('now')) as overdue_tasks
      FROM users u WHERE u.is_active = 1 ORDER BY u.last_name, u.first_name`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== DASHBOARD ==========
app.get('/api/dashboard', authMiddleware, (req, res) => {
  try {
    const myTasks = get('SELECT COUNT(*) as count FROM tasks WHERE assignee_id = ? AND is_deleted = 0 AND status != \'done\'', [req.user.id]);
    const overdueTasks = get("SELECT COUNT(*) as count FROM tasks WHERE assignee_id = ? AND is_deleted = 0 AND status != 'done' AND deadline IS NOT NULL AND deadline < datetime('now')", [req.user.id]);
    const totalProjects = get("SELECT COUNT(*) as count FROM projects WHERE status != 'archived'");
    const unreadNotifications = get('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
    const recentTasks = all(`SELECT t.*, p.name as project_name, p.code as project_code, u.first_name || ' ' || u.last_name as assignee_name
      FROM tasks t JOIN projects p ON t.project_id = p.id LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.assignee_id = ? AND t.is_deleted = 0 ORDER BY t.updated_at DESC LIMIT 5`, [req.user.id]);
    const statusDistribution = all('SELECT status, COUNT(*) as count FROM tasks WHERE is_deleted = 0 GROUP BY status');
    res.json({ myTasks: myTasks.count, overdueTasks: overdueTasks.count, totalProjects: totalProjects.count, unreadNotifications: unreadNotifications.count, recentTasks, statusDistribution });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== DEMO DATA ==========
function seedDemoData() {
  const c = get('SELECT COUNT(*) as count FROM users');
  if (c.count > 0) return;
  console.log('Создание демонстрационных данных...');

  const adminHash = bcrypt.hashSync('admin123', 10);
  const tempHash = bcrypt.hashSync('Temp1234', 10);

const u1=1,u2=2,u3=3,u4=4,u5=5,u6=6,u7=7,u8=8;
  run('INSERT INTO users (id,email,password_hash,first_name,last_name,position,role,is_first_login) VALUES(1,?,?,?,?,?,?,?)', ['admin@tracker.ru', adminHash, 'Алексей', 'Петров', 'Директор по IT', 'admin', 0]);
  run('INSERT INTO users (id,email,password_hash,first_name,last_name,position,role,is_first_login) VALUES(2,?,?,?,?,?,?,?)', ['ivanov@tracker.ru', tempHash, 'Дмитрий', 'Иванов', 'Руководитель проектов', 'project_manager', 1]);
  run('INSERT INTO users (id,email,password_hash,first_name,last_name,position,role,is_first_login) VALUES(3,?,?,?,?,?,?,?)', ['sidorova@tracker.ru', tempHash, 'Елена', 'Сидорова', 'Руководитель проектов', 'project_manager', 1]);
  run('INSERT INTO users (id,email,password_hash,first_name,last_name,position,role,is_first_login) VALUES(4,?,?,?,?,?,?,?)', ['smirnov@tracker.ru', tempHash, 'Сергей', 'Смирнов', 'Frontend-разработчик', 'employee', 1]);
  run('INSERT INTO users (id,email,password_hash,first_name,last_name,position,role,is_first_login) VALUES(5,?,?,?,?,?,?,?)', ['kuznetsova@tracker.ru', tempHash, 'Анна', 'Кузнецова', 'Backend-разработчик', 'employee', 1]);
  run('INSERT INTO users (id,email,password_hash,first_name,last_name,position,role,is_first_login) VALUES(6,?,?,?,?,?,?,?)', ['volkov@tracker.ru', tempHash, 'Михаил', 'Волков', 'Дизайнер', 'employee', 1]);
  run('INSERT INTO users (id,email,password_hash,first_name,last_name,position,role,is_first_login) VALUES(7,?,?,?,?,?,?,?)', ['novikova@tracker.ru', tempHash, 'Ольга', 'Новикова', 'Тестировщик', 'employee', 1]);
  run('INSERT INTO users (id,email,password_hash,first_name,last_name,position,role,is_first_login) VALUES(8,?,?,?,?,?,?,?)', ['morozov@tracker.ru', tempHash, 'Андрей', 'Морозов', 'DevOps-инженер', 'employee', 1]);

  const p1=1,p2=2,p3=3;
  run('INSERT INTO projects (id,name,description,code,lead_id,status,start_date,planned_end_date,allow_members_create_tasks) VALUES(1,?,?,?,?,?,?,?,?)', ['Сайт компании', 'Разработка и поддержка корпоративного сайта', 'SIT', u2, 'active', '2024-01-15', '2024-06-30', 1]);
  run('INSERT INTO projects (id,name,description,code,lead_id,status,start_date,planned_end_date,allow_members_create_tasks) VALUES(2,?,?,?,?,?,?,?,?)', ['Мобильное приложение', 'KPI-трекер для сотрудников', 'MVP', u3, 'active', '2024-03-01', '2024-12-31', 0]);
  run('INSERT INTO projects (id,name,description,code,lead_id,status,start_date,planned_end_date,allow_members_create_tasks) VALUES(3,?,?,?,?,?,?,?,?)', ['Внутренний CRM', 'CRM-система для отдела продаж', 'CRM', u2, 'planned', '2024-06-01', '2024-12-31', 0]);

  [[p1,u2],[p1,u4],[p1,u6],[p1,u7],[p2,u3],[p2,u5],[p2,u7],[p2,u8],[p3,u2],[p3,u5]].forEach(([pid, uid]) => { try { run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [pid, uid]); } catch(e) {} });

  const tasksData = [
    [p1,'Дизайн главной страницы','Разработка макета главной страницы сайта','done','high',u6,u2,'2024-02-15','SIT001'],
    [p1,'Верстка шапки сайта','Адаптивная верстка шапки с навигацией','done','medium',u4,u2,'2024-02-20','SIT002'],
    [p1,'Настройка формы обратной связи','Интеграция формы с email-рассылкой','in_progress','medium',u4,u2,'2024-03-10','SIT003'],
    [p1,'SEO-оптимизация','Meta-теги, структура, скорость загрузки','planned','high',u6,u2,'2024-03-20','SIT004'],
    [p1,'Тестирование кроссбраузерности','Проверка в Chrome, Firefox, Safari, Edge','backlog','medium',u7,u2,null,'SIT005'],
    [p1,'Деплой на продакшн','Настройка сервера и деплой','backlog','high',u8,u2,'2024-04-01','SIT006'],
    [p1,'Контент для страницы О нас','Написание текстов и подбор фото','in_progress','low',u6,u2,'2024-03-05','SIT007'],
    [p1,'Исправление бага в навигации','Меню не закрывается на мобильных','review','critical',u4,u2,'2024-02-28','SIT008'],
    [p2,'Прототип главного экрана','Wireframe для основного экрана приложения','done','high',u5,u3,'2024-03-15','MVP001'],
    [p2,'Авторизация через корпоративный email','OAuth2 интеграция','in_progress','critical',u5,u3,'2024-04-01','MVP002'],
    [p2,'Экран KPI-дашборда','Графики и показатели для сотрудников','planned','high',u5,u3,'2024-04-15','MVP003'],
    [p2,'Push-уведомления','Настройка push для iOS и Android','backlog','medium',u8,u3,'2024-05-01','MVP004'],
    [p2,'Тестирование на реальных устройствах','QA на iOS 15+ и Android 10+','backlog','medium',u7,u3,'2024-06-01','MVP005'],
    [p2,'Публикация в App Store','Подготовка скриншотов и описания','backlog','low',u3,u3,'2024-07-01','MVP006'],
    [p2,'Дизайн иконки приложения','Иконка для App Store и Google Play','done','medium',u6,u3,'2024-03-01','MVP007'],
    [p2,'API для синхронизации данных','REST API для синхронизации KPI','in_progress','high',u5,u3,'2024-04-10','MVP008'],
    [p3,'Техническое задание на CRM','Детальное ТЗ с прототипами','in_progress','critical',u2,u1,'2024-07-01','CRM001'],
    [p3,'Архитектура базы данных','Проектирование схемы БД','planned','high',u5,u2,'2024-07-15','CRM002'],
    [p3,'UI/UX дизайн интерфейсов','Дизайн всех экранов CRM','planned','medium',u6,u2,'2024-08-01','CRM003'],
    [p3,'Модуль клиентов','CRUD для клиентов и контактов','backlog','high',u5,u2,'2024-09-01','CRM004'],
    [p3,'Модуль сделок','Воронка продаж и этапы сделок','backlog','medium',u5,u2,'2024-10-01','CRM005'],
    [p3,'Интеграция с почтой','Получение и отправка писем','backlog','low',u4,u2,'2024-11-01','CRM006'],
    [p3,'Отчёты и аналитика','Дашборды и отчёты по продажам','backlog','medium',u2,u2,'2024-12-01','CRM007'],
    [p3,'Миграция данных','Перенос данных из старой системы','backlog','high',u8,u2,'2024-11-15','CRM008'],
    [p3,'Обратная связь от отдела продаж','Сбор требований и пожеланий','review','medium',u2,u2,'2024-07-10','CRM009'],
  ];

  const taskIds = [];
  tasksData.forEach((t, i) => {
    const tid = 100 + i;
    run('INSERT INTO tasks (id,project_id,title,description,status,priority,assignee_id,reporter_id,deadline,sort_order,task_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [tid, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], i, t[8]]);
    taskIds.push(tid);
    run('INSERT INTO task_order (task_id, project_id, status, sort_order) VALUES (?, ?, ?, ?)', [tid, t[0], t[3], i]);
  });

  run('INSERT INTO comments (task_id, user_id, content, created_at) VALUES (?, ?, ?, ?)', [taskIds[2], u4, 'Начал работу над формой. Использую React-hook-form.', '2024-02-20 10:00:00']);
  run('INSERT INTO comments (task_id, user_id, content, created_at) VALUES (?, ?, ?, ?)', [taskIds[2], u2, 'Отлично, не забудь про валидацию на клиенте.', '2024-02-20 11:30:00']);
  run('INSERT INTO comments (task_id, user_id, content, created_at) VALUES (?, ?, ?, ?)', [taskIds[7], u4, 'Баг исправлен, PR создан: #123', '2024-02-25 14:00:00']);
  run('INSERT INTO comments (task_id, user_id, content, created_at) VALUES (?, ?, ?, ?)', [taskIds[9], u5, 'OAuth2 настроен, нужен тест на реальном домене', '2024-03-10 09:00:00']);
  run('INSERT INTO comments (task_id, user_id, content, created_at) VALUES (?, ?, ?, ?)', [taskIds[16], u2, 'ТЗ готово на 80%, нужно доработать раздел интеграций', '2024-06-20 16:00:00']);
  run('INSERT INTO comments (task_id, user_id, content, created_at) VALUES (?, ?, ?, ?)', [taskIds[0], u6, 'Дизайн утверждён, передаю в вёрстку', '2024-02-10 12:00:00']);

  run('INSERT INTO task_history (task_id, user_id, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)', [taskIds[2], u4, 'status', 'planned', 'in_progress', '2024-02-20 09:00:00']);
  run('INSERT INTO task_history (task_id, user_id, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)', [taskIds[7], u4, 'status', 'in_progress', 'review', '2024-02-25 14:00:00']);
  run('INSERT INTO task_history (task_id, user_id, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)', [taskIds[9], u5, 'priority', 'high', 'critical', '2024-03-05 08:00:00']);
  run('INSERT INTO task_history (task_id, user_id, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)', [taskIds[0], u6, 'status', 'in_progress', 'done', '2024-02-14 17:00:00']);

  console.log('Демоданные созданы: 8 пользователей, 3 проекта, 25 задач');
}

// ========== START ==========
async function start() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  initDatabase();
  seedDemoData();
  saveDB();

  app.use(express.static(path.join(__dirname, '..', 'frontend')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) {
      res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
    }
  });

  app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
}

start().catch(console.error);
