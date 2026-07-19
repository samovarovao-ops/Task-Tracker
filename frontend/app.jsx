const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;

const API = 'http://localhost:3001';

// ========== API HELPER ==========
function api(path, opts = {}) {
  const token = localStorage.getItem('token');
  const headers = { ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(`${API}${path}`, { ...opts, headers })
    .then(async r => {
      if (r.status === 401) { localStorage.removeItem('token'); window.location.reload(); throw new Error('Unauthorized'); }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Ошибка');
      return data;
    });
}

// ========== CONTEXT ==========
const AppContext = createContext();

// ========== HELPERS ==========
function initials(firstName, lastName) {
  return ((firstName || '')[0] || '') + ((lastName || '')[0] || '');
}

function formatDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d)) return dt;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isOverdue(deadline, status) {
  if (!deadline || status === 'done') return false;
  return new Date(deadline) < new Date();
}

function priorityColor(p) {
  return { critical: '#DC2626', high: '#F97316', medium: '#EAB308', low: '#22C55E' }[p] || '#9CA3AF';
}

function statusLabel(s) {
  return { backlog: 'Бэклог', planned: 'Запланировано', in_progress: 'В работе', review: 'На проверке', done: 'Выполнено' }[s] || s;
}

function statusBadgeClass(s) {
  return `badge-status badge-${s}`;
}

function priorityLabel(p) {
  return { critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий' }[p] || p;
}

// ========== TOAST ==========
let toastId = 0;
function ToastContainer({ toasts, removeToast }) {
  return <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300 }}>
    {toasts.map(t => <div key={t.id} className={`toast ${t.type || ''}`} onClick={() => removeToast(t.id)}>
      {t.message}
    </div>)}
  </div>;
}

// ========== AVATAR ==========
function Avatar({ firstName, lastName, url, size = 36 }) {
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  const s = size < 32 ? 'small' : '';
  return <div className={`avatar ${s}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
    {initials(firstName, lastName)}
  </div>;
}

// ========== MODAL ==========
function Modal({ title, onClose, children, footer }) {
  return <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="modal">
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="modal-close" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>;
}

// ========== SIDE PANEL ==========
function SidePanel({ title, onClose, children }) {
  return <>
    <div className="side-panel-overlay" onClick={onClose} />
    <div className="side-panel">
      <div className="side-panel-header">
        <h2 style={{ fontSize: 16 }}>{title}</h2>
        <button className="modal-close" onClick={onClose}>&times;</button>
      </div>
      <div className="side-panel-body">{children}</div>
    </div>
  </>;
}

// ========== LOGIN PAGE ==========
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      localStorage.setItem('token', data.token);
      onLogin(data.user);
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  return <div className="login-page">
    <div className="login-card">
      <img src="/uploads/logomain.jpg" alt="Логотип" className="login-logo" />
      <h1>Трекер задач</h1>
      <p>Вход в систему</p>
      {error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@tracker.ru" required />
        </div>
        <div className="form-group">
          <label>Пароль</label>
          <div style={{ position: 'relative' }}>
            <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="admin123" required style={{ paddingRight: 40 }} />
            <button type="button" onClick={() => setShowPwd(!showPwd)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', fontSize: 18 }}>{showPwd ? '🙈' : '👁'}</button>
          </div>
        </div>
        <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ marginTop: 8 }}>
          {loading ? 'Вход...' : 'Войти'}
        </button>
      </form>
    </div>
  </div>;
}

// ========== PASSWORD CHANGE MODAL ==========
function PasswordChangeModal({ onDone }) {
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async e => {
    e.preventDefault();
    if (newPwd !== confirm) { setError('Пароли не совпадают'); return; }
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: newPwd } });
      onDone();
    } catch (err) { setError(err.message); }
  };

  return <Modal title="Смена пароля" onClose={() => {}}>
    <div style={{ background: '#FEF3C7', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
      Вы вошли с временным паролем. Для безопасности необходимо сменить его.
    </div>
    {error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{error}</div>}
    <form onSubmit={handleSubmit}>
      <div className="form-group"><label>Текущий пароль</label><input type="password" value={current} onChange={e => setCurrent(e.target.value)} required /></div>
      <div className="form-group"><label>Новый пароль</label><input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required minLength={8} /></div>
      <div className="form-group"><label>Подтвердите пароль</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></div>
      <button type="submit" className="btn btn-primary btn-full">Сменить пароль</button>
    </form>
  </Modal>;
}

// ========== TASK CARD ==========
function TaskCard({ task, onClick, onDragStart }) {
  const deadline = task.deadline ? formatDate(task.deadline) : null;
  const overdue = isOverdue(task.deadline, task.status);
  return <div className="task-card" draggable onDragStart={e => { e.dataTransfer.setData('taskId', task.id); e.dataTransfer.effectAllowed = 'move'; if (onDragStart) onDragStart(task); }}
    onClick={() => onClick && onClick(task)}>
    <div className="task-card-header">
      <span className="task-id">{task.task_code || `#${task.id}`}</span>
      <div className={`priority-dot ${task.priority}`} title={priorityLabel(task.priority)} />
    </div>
    <div className="task-title">{task.title}</div>
    <div className="task-footer">
      <div className="task-meta">
        {task.assignee_name && <Avatar firstName={task.assignee_name?.split(' ')[0]} lastName={task.assignee_name?.split(' ')[1]} url={task.assignee_avatar} size={24} />}
        {deadline && <span className={`task-deadline ${overdue ? 'overdue' : ''}`}>{overdue ? '⚠ ' : ''}{deadline}</span>}
      </div>
      <div className="task-meta">
        {task.comment_count > 0 && <span className="comment-icon">💬{task.comment_count}</span>}
      </div>
    </div>
  </div>;
}

// ========== KANBAN BOARD ==========
function KanbanBoard({ tasks, onTaskClick, onStatusChange, collapsedDone = true }) {
  const [collapsed, setCollapsed] = useState({ done: collapsedDone });
  const [dragOverCol, setDragOverCol] = useState(null);
  const columns = ['backlog', 'planned', 'in_progress', 'review', 'done'];

  const handleDragOver = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  const handleDrop = (e, status) => {
    e.preventDefault();
    setDragOverCol(null);
    const taskId = parseInt(e.dataTransfer.getData('taskId'));
    if (taskId) onStatusChange(taskId, status);
  };

  return <div className="kanban-board">
    {columns.map(col => {
      const colTasks = (tasks || []).filter(t => t.status === col);
      const isDone = col === 'done';
      const isCollapsed = isDone && collapsed.done;
      return <div key={col} className="kanban-column" onDragOver={handleDragOver}
        onDragEnter={() => setDragOverCol(col)} onDragLeave={() => setDragOverCol(null)}
        onDrop={e => handleDrop(e, col)}>
        <div className="column-header">
          <span>{statusLabel(col)} <span className="count">{colTasks.length}</span></span>
          {isDone && <button className="toggle-btn" onClick={() => setCollapsed(p => ({ ...p, done: !p.done }))}>
            {isCollapsed ? 'Показать' : 'Скрыть'}
          </button>}
        </div>
        <div className={`column-body ${isCollapsed ? 'collapsed' : ''} ${dragOverCol === col ? 'drag-over' : ''}`}>
          {colTasks.length === 0 && <div className="empty-state" style={{ padding: 16 }}><p className="text-xs">Перетащите задачи сюда или создайте новую</p></div>}
          {colTasks.map(task => <TaskCard key={task.id} task={task} onClick={onTaskClick} />)}
        </div>
      </div>;
    })}
  </div>;
}

// ========== TASK TABLE ==========
function TaskTable({ tasks, onTaskClick }) {
  return <div className="table-container"><table>
    <thead><tr>
      <th>ID</th><th>Название</th><th>Статус</th><th>Исполнитель</th><th>Приоритет</th><th>Дедлайн</th>
    </tr></thead>
    <tbody>
      {(tasks || []).map(t => <tr key={t.id} onClick={() => onTaskClick(t)} style={{ cursor: 'pointer' }}>
        <td><span className="task-id">{t.task_code || `#${t.id}`}</span></td>
        <td className="truncate" style={{ maxWidth: 300 }}>{t.title}</td>
        <td><span className={statusBadgeClass(t.status)}>{statusLabel(t.status)}</span></td>
        <td><div className="flex items-center gap-2">
          <Avatar firstName={t.assignee_name?.split(' ')[0]} lastName={t.assignee_name?.split(' ')[1]} size={24} />
          <span className="text-sm">{t.assignee_name || '—'}</span>
        </div></td>
        <td><div className="flex items-center gap-2">
          <div className={`priority-dot ${t.priority}`} /><span className="text-sm">{priorityLabel(t.priority)}</span>
        </div></td>
        <td><span className={`task-deadline ${isOverdue(t.deadline, t.status) ? 'overdue' : ''}`}>{formatDate(t.deadline)}</span></td>
      </tr>)}
    </tbody>
  </table></div>;
}

// ========== TASK DETAIL PANEL ==========
function TaskDetailPanel({ task: initialTask, onClose, users, projects, addToast }) {
  const [task, setTask] = useState(initialTask);
  const [editing, setEditing] = useState(null);
  const [comment, setComment] = useState('');
  const [tab, setTab] = useState('comments');
  const [newTags, setNewTags] = useState('');

  const reload = () => api(`/api/tasks/${task.id}`).then(setTask).catch(() => {});

  useEffect(() => { reload(); }, [task.id]);

  const updateField = async (field, value) => {
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PUT', body: { [field]: value } });
      setTask(prev => ({ ...prev, [field]: value }));
      setEditing(null);
      addToast('Сохранено', 'success');
    } catch (err) { addToast(err.message, 'error'); }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    try {
      await api(`/api/tasks/${task.id}/comments`, { method: 'POST', body: { content: comment } });
      setComment('');
      reload();
    } catch (err) { addToast(err.message, 'error'); }
  };

  const deleteComment = async (commentId) => {
    if (!confirm('Удалить комментарий?')) return;
    try { await api(`/api/tasks/${task.id}/comments/${commentId}`, { method: 'DELETE' }); reload(); } catch (err) { addToast(err.message, 'error'); }
  };

  const deleteTask = async () => {
    if (!confirm('Переместить задачу в корзину?')) return;
    try { await api(`/api/tasks/${task.id}`, { method: 'DELETE' }); addToast('Задача удалена', 'success'); onClose(); } catch (err) { addToast(err.message, 'error'); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/api/tasks/${task.id}/attachments`, { method: 'POST', body: fd, headers: {} });
      addToast('Файл загружен', 'success');
      reload();
    } catch (err) { addToast(err.message, 'error'); }
  };

  const overdue = isOverdue(task.deadline, task.status);

  return <SidePanel title={`${task.task_code || ''} — ${task.title}`} onClose={onClose}>
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`priority-dot ${task.priority}`} /><span className="text-sm font-bold">{priorityLabel(task.priority)}</span>
      </div>
      <div className="mb-2"><span className={statusBadgeClass(task.status)}>{statusLabel(task.status)}</span></div>
      {overdue && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: 8, borderRadius: 8, fontSize: 13, marginBottom: 8 }}>⚠ Задача просрочена</div>}
    </div>

    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-bold">Исполнитель</label>
      </div>
      {editing === 'assignee' ? (
        <select value={task.assignee_id || ''} onChange={e => updateField('assignee_id', e.target.value ? parseInt(e.target.value) : null)} className="w-full">
          <option value="">Не назначен</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
        </select>
      ) : <div className="flex items-center gap-2" style={{ cursor: 'pointer' }} onClick={() => setEditing('assignee')}>
        {task.assignee_name ? <><Avatar firstName={task.assignee_name?.split(' ')[0]} lastName={task.assignee_name?.split(' ')[1]} url={task.assignee_avatar} size={28} /><span className="text-sm">{task.assignee_name}</span></> : <span className="text-sm text-secondary">Назначить</span>}
      </div>}
    </div>

    <div className="mb-4">
      <label className="text-sm font-bold mb-2" style={{ display: 'block' }}>Приоритет</label>
      {editing === 'priority' ? (
        <select value={task.priority} onChange={e => updateField('priority', e.target.value)} className="w-full">
          <option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option><option value="critical">Критический</option>
        </select>
      ) : <div className="text-sm" style={{ cursor: 'pointer', color: priorityColor(task.priority) }} onClick={() => setEditing('priority')}>{priorityLabel(task.priority)}</div>}
    </div>

    <div className="mb-4">
      <label className="text-sm font-bold mb-2" style={{ display: 'block' }}>Дедлайн</label>
      {editing === 'deadline' ? (
        <input type="datetime-local" value={task.deadline ? task.deadline.slice(0, 16) : ''} onChange={e => updateField('deadline', e.target.value || null)} className="w-full" />
      ) : <div className={`text-sm ${overdue ? 'task-deadline overdue' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setEditing('deadline')}>{task.deadline ? formatDate(task.deadline) : 'Установить'}</div>}
    </div>

    {task.description && <div className="mb-4">
      <label className="text-sm font-bold mb-2" style={{ display: 'block' }}>Описание</label>
      <p className="text-sm" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{task.description}</p>
    </div>}

    <div className="tabs">
      <div className={`tab ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}>Комментарии ({(task.comments || []).length})</div>
      <div className={`tab ${tab === 'attachments' ? 'active' : ''}`} onClick={() => setTab('attachments')}>Вложения ({(task.attachments || []).length})</div>
      <div className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>История</div>
    </div>

    {tab === 'comments' && <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Написать комментарий..." className="w-full" style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 }}
          onKeyDown={e => e.key === 'Enter' && addComment()} />
        <button className="btn btn-primary btn-sm" onClick={addComment}>Отправить</button>
      </div>
      {(task.comments || []).map(c => <div key={c.id} className="comment-item">
        <div className="comment-header">
          <Avatar firstName={c.author_name?.split(' ')[0]} lastName={c.author_name?.split(' ')[1]} size={24} />
          <span className="comment-author">{c.author_name}</span>
          <span className="comment-date">{formatDate(c.created_at)}</span>
        </div>
        <div className="comment-text">{c.content}</div>
        <div className="comment-actions">
          {c.user_id === JSON.parse(localStorage.getItem('user') || '{}').id && <button onClick={() => deleteComment(c.id)}>Удалить</button>}
        </div>
      </div>)}
      {(!task.comments || task.comments.length === 0) && <div className="empty-state"><p>Нет комментариев</p></div>}
    </div>}

    {tab === 'attachments' && <div>
      <div className="mb-4">
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
          Загрузить файл
          <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.pptx,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
        </label>
      </div>
      {(task.attachments || []).map(a => <div key={a.id} className="flex items-center justify-between mb-2" style={{ padding: '8px 12px', background: 'var(--bg)', borderRadius: 8 }}>
        <div className="flex items-center gap-2">
          <span>{a.original_name}</span>
          <span className="text-xs text-secondary">({Math.round(a.size / 1024)} KB)</span>
        </div>
        <div className="flex gap-2">
          <a href={`${API}/api/attachments/${a.id}/download`} className="btn btn-secondary btn-sm">Скачать</a>
          <button className="btn btn-danger btn-sm" onClick={async () => { if (confirm('Удалить?')) { await api(`/api/attachments/${a.id}`, { method: 'DELETE' }); reload(); } }}>✕</button>
        </div>
      </div>)}
      {(!task.attachments || task.attachments.length === 0) && <div className="empty-state"><p>Нет вложений</p></div>}
    </div>}

    {tab === 'history' && <div>
      {(task.history || []).map(h => <div key={h.id} className="history-item">
        <strong>{h.user_name || 'Система'}</strong> изменил <strong>{h.field}</strong>: {h.old_value || '—'} → {h.new_value || '—'}
        <span className="text-xs text-secondary" style={{ marginLeft: 8 }}>{formatDate(h.created_at)}</span>
      </div>)}
      {(!task.history || task.history.length === 0) && <div className="empty-state"><p>Нет записей</p></div>}
    </div>}

    <div className="mt-4" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <button className="btn btn-danger btn-sm" onClick={deleteTask}>Удалить задачу</button>
    </div>
  </SidePanel>;
}

// ========== CREATE TASK MODAL ==========
function CreateTaskModal({ projectId, projects, users, onClose, onCreated, addToast }) {
  const [form, setForm] = useState({ project_id: projectId || '', title: '', description: '', status: 'backlog', priority: 'medium', assignee_id: '', deadline: '' });

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.project_id || !form.title) return;
    try {
      const body = { ...form, project_id: parseInt(form.project_id) };
      if (form.assignee_id) body.assignee_id = parseInt(form.assignee_id);
      if (!form.deadline) delete body.deadline;
      await api('/api/tasks', { method: 'POST', body });
      addToast('Задача создана', 'success');
      onCreated();
    } catch (err) { addToast(err.message, 'error'); }
  };

  return <Modal title="Новая задача" onClose={onClose} footer={<>
    <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
    <button className="btn btn-primary" onClick={handleSubmit}>Создать</button>
  </>}>
    <form onSubmit={handleSubmit}>
      <div className="form-group"><label>Проект *</label>
        <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })} required>
          <option value="">Выберите проект</option>
          {projects.map(p => <option key={p.id} value={p.id}>[{p.code}] {p.name}</option>)}
        </select></div>
      <div className="form-group"><label>Название *</label><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required /></div>
      <div className="form-group"><label>Описание</label><textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
      <div className="flex gap-4">
        <div className="form-group" style={{ flex: 1 }}><label>Статус</label>
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="backlog">Бэклог</option><option value="planned">Запланировано</option><option value="in_progress">В работе</option><option value="review">На проверке</option><option value="done">Выполнено</option>
          </select></div>
        <div className="form-group" style={{ flex: 1 }}><label>Приоритет</label>
          <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option><option value="critical">Критический</option>
          </select></div>
      </div>
      <div className="form-group"><label>Исполнитель</label>
        <select value={form.assignee_id} onChange={e => setForm({ ...form, assignee_id: e.target.value })}>
          <option value="">Не назначен</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
        </select></div>
      <div className="form-group"><label>Дедлайн</label><input type="datetime-local" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
    </form>
  </Modal>;
}

// ========== CREATE PROJECT MODAL ==========
function CreateProjectModal({ users, onClose, onCreated, addToast }) {
  const [form, setForm] = useState({ name: '', description: '', code: '', lead_id: '', start_date: '', planned_end_date: '' });

  const handleSubmit = async e => {
    e.preventDefault();
    try {
      const body = { ...form, lead_id: parseInt(form.lead_id) };
      await api('/api/projects', { method: 'POST', body });
      addToast('Проект создан', 'success');
      onCreated();
    } catch (err) { addToast(err.message, 'error'); }
  };

  return <Modal title="Новый проект" onClose={onClose} footer={<>
    <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
    <button className="btn btn-primary" onClick={handleSubmit}>Создать</button>
  </>}>
    <form onSubmit={handleSubmit}>
      <div className="form-group"><label>Название *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
      <div className="form-group"><label>Код проекта *</label><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} required maxLength={10} placeholder="NDF" /></div>
      <div className="form-group"><label>Описание</label><textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
      <div className="form-group"><label>Руководитель *</label>
        <select value={form.lead_id} onChange={e => setForm({ ...form, lead_id: e.target.value })} required>
          <option value="">Выберите</option>
          {users.filter(u => u.role === 'admin' || u.role === 'project_manager').map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
        </select></div>
      <div className="flex gap-4">
        <div className="form-group" style={{ flex: 1 }}><label>Дата начала</label><input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
        <div className="form-group" style={{ flex: 1 }}><label>Плановая дата завершения</label><input type="date" value={form.planned_end_date} onChange={e => setForm({ ...form, planned_end_date: e.target.value })} /></div>
      </div>
    </form>
  </Modal>;
}

// ========== DASHBOARD ==========
function Dashboard({ user }) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/dashboard').then(setData).catch(() => {}); }, []);
  if (!data) return <div className="page-content"><p>Загрузка...</p></div>;

  return <div className="page-content">
    <div className="stats-grid">
      <div className="stat-card"><div className="stat-label">Мои задачи</div><div className="stat-value">{data.myTasks}</div></div>
      <div className="stat-card"><div className="stat-label">Просроченные</div><div className={`stat-value ${data.overdueTasks > 0 ? 'danger' : ''}`}>{data.overdueTasks}</div></div>
      <div className="stat-card"><div className="stat-label">Проектов</div><div className="stat-value">{data.totalProjects}</div></div>
      <div className="stat-card"><div className="stat-label">Уведомлений</div><div className="stat-value">{data.unreadNotifications}</div></div>
    </div>
    <div className="card">
      <div className="card-header"><span className="card-title">Недавние задачи</span></div>
      {data.recentTasks.length === 0 ? <div className="empty-state"><p>Нет задач</p></div> :
        <div className="table-container"><table><thead><tr><th>ID</th><th>Название</th><th>Проект</th><th>Статус</th><th>Приоритет</th></tr></thead><tbody>
          {data.recentTasks.map(t => <tr key={t.id}><td className="task-id">{t.task_code}</td><td>{t.title}</td><td className="text-sm">{t.project_name}</td>
            <td><span className={statusBadgeClass(t.status)}>{statusLabel(t.status)}</span></td>
            <td><div className="flex items-center gap-2"><div className={`priority-dot ${t.priority}`} /><span className="text-sm">{priorityLabel(t.priority)}</span></div></td></tr>)}
        </tbody></table></div>}
    </div>
    {data.statusDistribution.length > 0 && <div className="card">
      <div className="card-header"><span className="card-title">Распределение по статусам</span></div>
      <div style={{ display: 'flex', gap: 8, height: 24, borderRadius: 8, overflow: 'hidden' }}>
        {data.statusDistribution.map(s => {
          const total = data.statusDistribution.reduce((a, b) => a + b.count, 0);
          const pct = total ? (s.count / total * 100) : 0;
          const colors = { backlog: '#9CA3AF', planned: '#3B82F6', in_progress: '#F59E0B', review: '#6366F1', done: '#10B981' };
          return pct > 0 ? <div key={s.status} title={`${statusLabel(s.status)}: ${s.count}`} style={{ width: `${pct}%`, background: colors[s.status] || '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'white', fontWeight: 500 }}>{s.count}</div> : null;
        })}
      </div>
      <div className="flex gap-4 mt-2" style={{ flexWrap: 'wrap' }}>
        {data.statusDistribution.map(s => <div key={s.status} className="flex items-center gap-2 text-xs">
          <div style={{ width: 10, height: 10, borderRadius: 2, background: { backlog: '#9CA3AF', planned: '#3B82F6', in_progress: '#F59E0B', review: '#6366F1', done: '#10B981' }[s.status] }} />
          {statusLabel(s.status)}: {s.count}
        </div>)}
      </div>
    </div>}
  </div>;
}

// ========== MY TASKS PAGE ==========
function MyTasksPage({ users }) {
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState('board');
  const [selectedTask, setSelectedTask] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [projects, setProjects] = useState([]);

  useEffect(() => { api('/api/tasks/my').then(setTasks).catch(() => {}); api('/api/projects').then(setProjects).catch(() => {}); }, []);

  const handleStatusChange = async (taskId, status) => {
    try {
      await api(`/api/tasks/${taskId}/order`, { method: 'PUT', body: { status, sort_order: 0 } });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    } catch (err) { alert(err.message); }
  };

  return <div className="page-content">
    <div className="flex items-center justify-between mb-4">
      <div className="flex gap-2">
        <button className={`btn btn-sm ${view === 'board' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('board')}>Доска</button>
        <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('list')}>Список</button>
      </div>
      <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Задача</button>
    </div>
    {view === 'board' ? <KanbanBoard tasks={tasks} onTaskClick={setSelectedTask} onStatusChange={handleStatusChange} /> : <TaskTable tasks={tasks} onTaskClick={setSelectedTask} />}
    {selectedTask && <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} users={users} projects={projects} addToast={(m, t) => {}} />}
    {showCreate && <CreateTaskModal projects={projects} users={users} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); api('/api/tasks/my').then(setTasks); }} addToast={(m, t) => { alert(m); }} />}
  </div>;
}

// ========== PROJECTS PAGE ==========
function ProjectsPage({ user }) {
  const [projects, setProjects] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    api('/api/projects').then(setProjects).catch(() => {});
    api('/api/users').then(setUsers).catch(() => {});
  }, []);

  if (selectedProject) return <ProjectPage project={selectedProject} onBack={() => { setSelectedProject(null); api('/api/projects').then(setProjects); }} user={user} users={users} />;

  return <div className="page-content">
    <div className="flex items-center justify-between mb-4">
      <h2 style={{ fontSize: 18 }}>Проекты</h2>
      {user.role === 'admin' && <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Проект</button>}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
      {projects.map(p => <div key={p.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setSelectedProject(p)}>
        <div className="flex items-center justify-between mb-2">
          <span className="task-id">[{p.code}]</span>
          <span className={statusBadgeClass(p.status)}>{statusLabel(p.status)}</span>
        </div>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>{p.name}</h3>
        {p.description && <p className="text-sm text-secondary mb-2" style={{ lineHeight: 1.4 }}>{p.description.slice(0, 100)}{p.description.length > 100 ? '...' : ''}</p>}
        <div className="text-xs text-secondary mb-2">Руководитель: {p.lead_name}</div>
        <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${p.total_tasks ? (p.done_tasks / p.total_tasks * 100) : 0}%`, background: 'var(--success)', borderRadius: 3 }} />
        </div>
        <div className="text-xs text-secondary mt-2">{p.done_tasks || 0} из {p.total_tasks || 0} задач выполнено</div>
      </div>)}
    </div>
    {showCreate && <CreateProjectModal users={users} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); api('/api/projects').then(setProjects); }} addToast={(m, t) => { alert(m); }} />}
  </div>;
}

// ========== PROJECT PAGE ==========
function ProjectPage({ project: initialProject, onBack, user, users }) {
  const [project, setProject] = useState(initialProject);
  const [tab, setTab] = useState('board');
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  const load = () => {
    api(`/api/projects/${project.id}`).then(d => { setProject(d); setMembers(d.members || []); }).catch(() => {});
    api(`/api/tasks?project_id=${project.id}`).then(setTasks).catch(() => {});
  };

  useEffect(() => { load(); }, [project.id]);

  const handleStatusChange = async (taskId, status) => {
    try {
      await api(`/api/tasks/${taskId}/order`, { method: 'PUT', body: { status, sort_order: 0 } });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    } catch (err) { alert(err.message); }
  };

  const saveProject = async () => {
    try {
      await api(`/api/projects/${project.id}`, { method: 'PUT', body: form });
      setEditing(false);
      load();
    } catch (err) { alert(err.message); }
  };

  const addMember = async (userId) => {
    try { await api(`/api/projects/${project.id}/members`, { method: 'POST', body: { user_id: userId } }); load(); } catch (err) { alert(err.message); }
  };

  const removeMember = async (userId) => {
    if (!confirm('Удалить участника?')) return;
    try { await api(`/api/projects/${project.id}/members/${userId}`, { method: 'DELETE' }); load(); } catch (err) { alert(err.message); }
  };

  return <div className="page-content">
    <button className="btn btn-secondary btn-sm mb-4" onClick={onBack}>← Назад к проектам</button>
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 style={{ fontSize: 20 }}>[{project.code}] {project.name}</h2>
        <p className="text-sm text-secondary">{project.lead_name} · {statusLabel(project.status)}</p>
      </div>
    </div>
    <div className="tabs">
      <div className={`tab ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>Доска</div>
      <div className={`tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>Список задач</div>
      <div className={`tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>Участники ({members.length})</div>
      <div className={`tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Информация</div>
    </div>

    {tab === 'board' && <>
      <div className="flex justify-between mb-4"><button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Задача</button></div>
      <KanbanBoard tasks={tasks} onTaskClick={setSelectedTask} onStatusChange={handleStatusChange} collapsedDone={true} />
    </>}
    {tab === 'list' && <>
      <div className="flex justify-between mb-4"><button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Задача</button></div>
      <TaskTable tasks={tasks} onTaskClick={setSelectedTask} />
    </>}
    {tab === 'members' && <div>
      <div className="mb-4">
        <select onChange={e => { if (e.target.value) { addMember(parseInt(e.target.value)); e.target.value = ''; } }} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
          <option value="">Добавить участника...</option>
          {users.filter(u => !members.find(m => m.id === u.id)).map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
        </select>
      </div>
      {members.map(m => <div key={m.id} className="member-card">
        <Avatar firstName={m.first_name} lastName={m.last_name} url={m.avatar_url} />
        <div className="member-info"><div className="member-name">{m.first_name} {m.last_name}</div><div className="member-position">{m.position || m.email}</div></div>
        {(user.role === 'admin' || project.lead_id === user.id) && m.id !== project.lead_id &&
          <button className="btn btn-danger btn-sm" onClick={() => removeMember(m.id)}>Удалить</button>}
      </div>)}
    </div>}
    {tab === 'info' && <div className="card">
      {editing ? <>
        <div className="form-group"><label>Название</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div className="form-group"><label>Описание</label><textarea rows={3} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="form-group"><label>Статус</label>
          <select value={form.status || ''} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="planned">Планируется</option><option value="active">Активный</option><option value="paused">Приостановлен</option><option value="completed">Завершён</option><option value="archived">Архивный</option>
          </select></div>
        <div className="flex gap-4">
          <div className="form-group" style={{ flex: 1 }}><label>Дата начала</label><input type="date" value={form.start_date || ''} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
          <div className="form-group" style={{ flex: 1 }}><label>Плановая дата завершения</label><input type="date" value={form.planned_end_date || ''} onChange={e => setForm({ ...form, planned_end_date: e.target.value })} /></div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={saveProject}>Сохранить</button>
          <button className="btn btn-secondary" onClick={() => setEditing(false)}>Отмена</button>
        </div>
      </> : <>
        <div className="mb-2"><strong>Описание:</strong> {project.description || '—'}</div>
        <div className="mb-2"><strong>Код:</strong> {project.code}</div>
        <div className="mb-2"><strong>Руководитель:</strong> {project.lead_name}</div>
        <div className="mb-2"><strong>Статус:</strong> <span className={statusBadgeClass(project.status)}>{statusLabel(project.status)}</span></div>
        <div className="mb-2"><strong>Дата начала:</strong> {formatDate(project.start_date)}</div>
        <div className="mb-2"><strong>Плановая дата завершения:</strong> {formatDate(project.planned_end_date)}</div>
        {(user.role === 'admin' || project.lead_id === user.id) && <button className="btn btn-primary btn-sm mt-4" onClick={() => { setForm({ name: project.name, description: project.description, status: project.status, start_date: project.start_date, planned_end_date: project.planned_end_date }); setEditing(true); }}>Редактировать</button>}
      </>}
    </div>}

    {selectedTask && <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} users={users} projects={[project]} addToast={(m, t) => { alert(m); }} />}
    {showCreate && <CreateTaskModal projectId={project.id} projects={[project]} users={users} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} addToast={(m, t) => { alert(m); }} />}
  </div>;
}

// ========== TEAM PAGE ==========
function TeamPage() {
  const [members, setMembers] = useState([]);
  useEffect(() => { api('/api/team').then(setMembers).catch(() => {}); }, []);

  return <div className="page-content">
    <h2 style={{ fontSize: 20, marginBottom: 16 }}>Команда</h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
      {members.map(m => <div key={m.id} className="member-card">
        <Avatar firstName={m.first_name} lastName={m.last_name} url={m.avatar_url} size={48} />
        <div className="member-info">
          <div className="member-name">{m.first_name} {m.last_name}</div>
          <div className="member-position">{m.position || '—'}</div>
          <div className="member-stats mt-2">
            <span>Активных: {m.active_tasks || 0}</span>
            <span className={m.overdue_tasks > 0 ? 'task-deadline overdue' : ''}>Просрочено: {m.overdue_tasks || 0}</span>
          </div>
        </div>
      </div>)}
    </div>
  </div>;
}

// ========== NOTIFICATIONS PAGE ==========
function NotificationsPage({ onNotifyCountChange }) {
  const [notifications, setNotifications] = useState([]);
  useEffect(() => { api('/api/notifications').then(setNotifications).catch(() => {}); }, []);

  const markRead = async (id) => {
    await api(`/api/notifications/${id}/read`, { method: 'POST' });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
    onNotifyCountChange && onNotifyCountChange();
  };

  const markAllRead = async () => {
    await api('/api/notifications/read-all', { method: 'POST' });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    onNotifyCountChange && onNotifyCountChange();
  };

  return <div className="page-content">
    <div className="flex items-center justify-between mb-4">
      <h2 style={{ fontSize: 20 }}>Уведомления</h2>
      {notifications.some(n => !n.is_read) && <button className="btn btn-secondary btn-sm" onClick={markAllRead}>Отметить все как прочитанные</button>}
    </div>
    {notifications.length === 0 ? <div className="empty-state"><div className="icon">🔔</div><p>Нет уведомлений</p></div> :
      notifications.map(n => <div key={n.id} className="card" style={{ padding: 14, borderLeft: n.is_read ? '3px solid transparent' : '3px solid var(--primary)', opacity: n.is_read ? 0.7 : 1, cursor: 'pointer' }}
        onClick={() => markRead(n.id)}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold">{n.title}</div>
            <div className="text-sm text-secondary">{n.message}</div>
            <div className="text-xs text-secondary mt-2">{formatDate(n.created_at)}</div>
          </div>
          {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />}
        </div>
      </div>)}
  </div>;
}

// ========== PROFILE PAGE ==========
function ProfilePage({ user, setUser }) {
  const [form, setForm] = useState({ first_name: user.first_name, last_name: user.last_name, position: user.position || '', timezone: user.timezone || 'Europe/Moscow' });
  const [pwd, setPwd] = useState({ current: '', newPwd: '', confirm: '' });

  const saveProfile = async () => {
    try {
      const updated = await api(`/api/users/${user.id}`, { method: 'PUT', body: form });
      setUser(updated);
      alert('Профиль сохранён');
    } catch (err) { alert(err.message); }
  };

  const changePassword = async () => {
    if (pwd.newPwd !== pwd.confirm) { alert('Пароли не совпадают'); return; }
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: pwd.current, newPassword: pwd.newPwd } });
      setPwd({ current: '', newPwd: '', confirm: '' });
      alert('Пароль изменён');
    } catch (err) { alert(err.message); }
  };

  return <div className="page-content" style={{ maxWidth: 600 }}>
    <h2 style={{ fontSize: 20, marginBottom: 16 }}>Профиль</h2>
    <div className="card">
      <div className="flex items-center gap-4 mb-4">
        <Avatar firstName={user.first_name} lastName={user.last_name} url={user.avatar_url} size={64} />
        <div>
          <div className="font-bold">{user.first_name} {user.last_name}</div>
          <div className="text-sm text-secondary">{user.email}</div>
          <div className="text-xs text-secondary">{user.role}</div>
        </div>
      </div>
      <div className="form-group"><label>Имя</label><input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} /></div>
      <div className="form-group"><label>Фамилия</label><input value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} /></div>
      <div className="form-group"><label>Должность</label><input value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} /></div>
      <div className="form-group"><label>Часовой пояс</label>
        <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}>
          <option value="Europe/Moscow">Москва (UTC+3)</option><option value="Europe/Kaliningrad">Калининград (UTC+2)</option>
          <option value="Asia/Yekaterinburg">Екатеринбург (UTC+5)</option><option value="Asia/Novosibirsk">Новосибирск (UTC+7)</option>
          <option value="Asia/Vladivostok">Владивосток (UTC+10)</option>
        </select></div>
      <button className="btn btn-primary" onClick={saveProfile}>Сохранить</button>
    </div>

    <div className="card mt-4">
      <h3 style={{ fontSize: 16, marginBottom: 16 }}>Сменить пароль</h3>
      <div className="form-group"><label>Текущий пароль</label><input type="password" value={pwd.current} onChange={e => setPwd({ ...pwd, current: e.target.value })} /></div>
      <div className="form-group"><label>Новый пароль</label><input type="password" value={pwd.newPwd} onChange={e => setPwd({ ...pwd, newPwd: e.target.value })} minLength={8} /></div>
      <div className="form-group"><label>Подтверждение</label><input type="password" value={pwd.confirm} onChange={e => setPwd({ ...pwd, confirm: e.target.value })} /></div>
      <button className="btn btn-primary" onClick={changePassword}>Сменить пароль</button>
    </div>
  </div>;
}

// ========== ADMIN PAGE ==========
function AdminPage() {
  const [users, setUsers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', position: '', role: 'employee' });
  const [tempPassword, setTempPassword] = useState(null);

  useEffect(() => { api('/api/users').then(setUsers).catch(() => {}); }, []);

  const createUser = async () => {
    if (!form.email || !form.first_name || !form.last_name) { alert('Заполните обязательные поля'); return; }
    try {
      const result = await api('/api/users', { method: 'POST', body: form });
      setTempPassword(result.tempPassword);
      setForm({ email: '', first_name: '', last_name: '', position: '', role: 'employee' });
      api('/api/users').then(setUsers);
    } catch (err) { alert(err.message); }
  };

  const resetPassword = async (userId) => {
    if (!confirm('Сбросить пароль пользователя?')) return;
    try {
      const result = await api(`/api/users/${userId}/reset-password`, { method: 'POST' });
      alert(`Новый временный пароль: ${result.tempPassword}`);
    } catch (err) { alert(err.message); }
  };

  const deactivate = async (userId) => {
    if (!confirm('Деактивировать пользователя?')) return;
    try { await api(`/api/users/${userId}/deactivate`, { method: 'POST' }); api('/api/users').then(setUsers); } catch (err) { alert(err.message); }
  };

  return <div className="page-content">
    <div className="flex items-center justify-between mb-4">
      <h2 style={{ fontSize: 20 }}>Управление пользователями</h2>
      <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Пользователь</button>
    </div>

    <div className="table-container"><table>
      <thead><tr><th>Пользователь</th><th>Email</th><th>Роль</th><th>Активных</th><th>Просрочено</th><th>Действия</th></tr></thead>
      <tbody>
        {users.map(u => <tr key={u.id}>
          <td><div className="flex items-center gap-2"><Avatar firstName={u.first_name} lastName={u.last_name} size={28} /><span>{u.first_name} {u.last_name}</span></div></td>
          <td className="text-sm">{u.email}</td>
          <td><span className="badge-status" style={{ background: u.role === 'admin' ? '#FEE2E2' : u.role === 'project_manager' ? '#DBEAFE' : '#F3F4F6', color: u.role === 'admin' ? '#DC2626' : u.role === 'project_manager' ? '#2563EB' : '#6B7280' }}>
            {u.role === 'admin' ? 'Администратор' : u.role === 'project_manager' ? 'Руководитель' : 'Сотрудник'}
          </span></td>
          <td>{u.active_tasks || 0}</td>
          <td className={u.overdue_tasks > 0 ? 'task-deadline overdue' : ''}>{u.overdue_tasks || 0}</td>
          <td><div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => resetPassword(u.id)}>Сбросить пароль</button>
            <button className="btn btn-danger btn-sm" onClick={() => deactivate(u.id)}>Деактивировать</button>
          </div></td>
        </tr>)}
      </tbody>
    </table></div>

    {showCreate && <Modal title="Новый пользователь" onClose={() => { setShowCreate(false); setTempPassword(null); }} footer={<>
      <button className="btn btn-secondary" onClick={() => { setShowCreate(false); setTempPassword(null); }}>Закрыть</button>
      {!tempPassword && <button className="btn btn-primary" onClick={createUser}>Создать</button>}
    </>}>
      {tempPassword ? <div>
        <div style={{ background: '#D1FAE5', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <div className="font-bold mb-2">Пользователь создан!</div>
          <div className="text-sm">Временный пароль (покажите один раз):</div>
          <div style={{ background: 'white', padding: 12, borderRadius: 8, marginTop: 8, fontFamily: 'monospace', fontSize: 16, textAlign: 'center' }}>{tempPassword}</div>
          <div className="text-xs mt-2" style={{ color: '#059669' }}>Передайте пароль пользователю. Повторно посмотреть его невозможно.</div>
        </div>
      </div> : <form>
        <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></div>
        <div className="form-group"><label>Имя *</label><input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} required /></div>
        <div className="form-group"><label>Фамилия *</label><input value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} required /></div>
        <div className="form-group"><label>Должность</label><input value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} /></div>
        <div className="form-group"><label>Роль *</label>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="employee">Сотрудник</option><option value="project_manager">Руководитель проекта</option><option value="admin">Администратор</option>
          </select></div>
      </form>}
    </Modal>}
  </div>;
}

// ========== SEARCH RESULTS ==========
function SearchResults({ results, onClose, onSelect }) {
  if (!results) return null;
  return <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, maxHeight: 400, overflowY: 'auto' }}>
    {results.projects?.length > 0 && <div><div className="text-xs text-secondary" style={{ padding: '8px 14px', fontWeight: 600 }}>Проекты</div>
      {results.projects.map(p => <div key={p.id} className="nav-item" onClick={() => onSelect('project', p.id)}>📁 [{p.code}] {p.name}</div>)}</div>}
    {results.tasks?.length > 0 && <div><div className="text-xs text-secondary" style={{ padding: '8px 14px', fontWeight: 600 }}>Задачи</div>
      {results.tasks.map(t => <div key={t.id} className="nav-item" onClick={() => onSelect('task', t.id)}>📋 {t.task_code} — {t.title}</div>)}</div>}
    {results.users?.length > 0 && <div><div className="text-xs text-secondary" style={{ padding: '8px 14px', fontWeight: 600 }}>Сотрудники</div>
      {results.users.map(u => <div key={u.id} className="nav-item" onClick={() => onSelect('user', u.id)}>👤 {u.first_name} {u.last_name}</div>)}</div>}
    {(!results.projects?.length && !results.tasks?.length && !results.users?.length) && <div className="empty-state" style={{ padding: 16 }}><p>Ничего не найдено</p></div>}
  </div>;
}

// ========== MAIN APP ==========
function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [notifyCount, setNotifyCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showPwdChange, setShowPwdChange] = useState(false);
  const [users, setUsers] = useState([]);
  const [toastList, setToastList] = useState([]);
  const searchTimeout = useRef(null);

  const addToast = (message, type = '') => {
    const id = ++toastId;
    setToastList(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToastList(prev => prev.filter(t => t.id !== id)), 3000);
  };
  const removeToast = (id) => setToastList(prev => prev.filter(t => t.id !== id));

  const loadNotifyCount = () => api('/api/notifications/unread-count').then(d => setNotifyCount(d.count)).catch(() => {});

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    api('/api/auth/me').then(u => {
      setUser(u);
      if (u.is_first_login) setShowPwdChange(true);
      loadNotifyCount();
      api('/api/users').then(setUsers).catch(() => {});
    }).catch(() => { localStorage.removeItem('token'); }).finally(() => setLoading(false));
  }, []);

  const handleSearch = (q) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults(null); return; }
    searchTimeout.current = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q)}`).then(setSearchResults).catch(() => {});
    }, 300);
  };

  const handleSearchSelect = (type, id) => {
    setSearchResults(null);
    setSearchQuery('');
    if (type === 'project') setPage('projects');
    else if (type === 'task') setPage('myTasks');
    else if (type === 'user') setPage('team');
  };

  const loadNotifications = () => {
    api('/api/notifications').then(setNotifications).catch(() => {});
    loadNotifyCount();
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><p>Загрузка...</p></div>;
  if (!user) return <LoginPage onLogin={(u) => { setUser(u); loadNotifyCount(); api('/api/users').then(setUsers); }} />;
  if (showPwdChange) return <PasswordChangeModal onDone={() => { setShowPwdChange(false); api('/api/auth/me').then(setUser); }} />;

  const navItems = [
    { id: 'dashboard', icon: '🏠', label: 'Главная' },
    { id: 'myTasks', icon: '📋', label: 'Мои задачи' },
    { id: 'projects', icon: '📁', label: 'Проекты' },
    { id: 'team', icon: '👥', label: 'Команда' },
    { id: 'notifications', icon: '🔔', label: 'Уведомления', badge: notifyCount },
    { id: 'profile', icon: '👤', label: 'Профиль' },
  ];
  if (user.role === 'admin') navItems.push({ id: 'admin', icon: '⚙️', label: 'Администрирование' });

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard user={user} />;
      case 'myTasks': return <MyTasksPage users={users} />;
      case 'projects': return <ProjectsPage user={user} />;
      case 'team': return <TeamPage />;
      case 'notifications': return <NotificationsPage onNotifyCountChange={loadNotifyCount} />;
      case 'profile': return <ProfilePage user={user} setUser={setUser} />;
      case 'admin': return user.role === 'admin' ? <AdminPage /> : <Dashboard user={user} />;
      default: return <Dashboard user={user} />;
    }
  };

  return <div className="app-layout">
    <div className="sidebar">
      <div className="sidebar-header"><img src="/uploads/logomain.jpg" alt="Логотип" className="logo" /><h2>Трекер задач</h2></div>
      <nav className="sidebar-nav">
        {navItems.map(item => <div key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); if (item.id === 'notifications') loadNotifications(); }}>
          <span className="icon">{item.icon}</span>
          <span>{item.label}</span>
          {item.badge > 0 && <span className="badge">{item.badge}</span>}
        </div>)}
      </nav>
      <div className="sidebar-footer">
        <div className="user-info">
          <Avatar firstName={user.first_name} lastName={user.last_name} />
          <div>
            <div className="user-name">{user.first_name} {user.last_name}</div>
            <div className="user-role">{user.role === 'admin' ? 'Администратор' : user.role === 'project_manager' ? 'Руководитель' : 'Сотрудник'}</div>
          </div>
        </div>
      </div>
    </div>

    <div className="main-content">
      <div className="topbar">
        <h1>{navItems.find(n => n.id === page)?.label || ''}</h1>
        <div className="topbar-actions">
          <div className="search-box" style={{ position: 'relative' }}>
            <span>🔍</span>
            <input placeholder="Поиск..." value={searchQuery} onChange={e => handleSearch(e.target.value)}
              onFocus={() => searchResults && setSearchResults(searchResults)} />
            <SearchResults results={searchResults} onSelect={handleSearchSelect} />
          </div>
          <button className="notification-btn" onClick={() => { setShowNotifDropdown(!showNotifDropdown); if (!showNotifDropdown) loadNotifications(); }}>
            🔔
            {notifyCount > 0 && <span className="notification-badge">{notifyCount}</span>}
          </button>
        </div>
      </div>
      {showNotifDropdown && <div style={{ position: 'absolute', top: 56, right: 24, width: 360, maxHeight: 400, overflowY: 'auto', background: 'white', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', zIndex: 100 }}>
        <div className="flex items-center justify-between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <span className="font-bold text-sm">Уведомления</span>
          <button className="btn btn-secondary btn-sm" onClick={() => { api('/api/notifications/read-all', { method: 'POST' }).then(() => { loadNotifyCount(); setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 }))); }); }}>Все прочитаны</button>
        </div>
        {notifications.length === 0 ? <div className="empty-state" style={{ padding: 16 }}><p>Нет уведомлений</p></div> :
          notifications.slice(0, 10).map(n => <div key={n.id} className="nav-item" style={{ opacity: n.is_read ? 0.6 : 1, borderBottom: '1px solid var(--border)' }}
            onClick={() => { setShowNotifDropdown(false); setPage('notifications'); }}>
            <div><div className="text-sm font-bold">{n.title}</div><div className="text-xs text-secondary">{n.message}</div></div>
          </div>)}
        <div className="nav-item" style={{ justifyContent: 'center', borderTop: '1px solid var(--border)' }} onClick={() => { setShowNotifDropdown(false); setPage('notifications'); }}>
          <span className="text-sm" style={{ color: 'var(--primary)' }}>Все уведомления</span>
        </div>
      </div>}

      {renderPage()}
    </div>

    <ToastContainer toasts={toastList} removeToast={removeToast} />
  </div>;
}

// ========== RENDER ==========
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
