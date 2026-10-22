const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nocturnal-dev-secret-change-me';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'nocturnal.db');

/* ===================== DATABASE ===================== */
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    email    TEXT NOT NULL UNIQUE,
    pass     TEXT NOT NULL,
    color    TEXT NOT NULL,
    role     TEXT NOT NULL DEFAULT 'user',
    active   INTEGER NOT NULL DEFAULT 1,
    created  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS books (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    title    TEXT NOT NULL,
    author   TEXT NOT NULL,
    genre    TEXT NOT NULL,
    pages    INTEGER NOT NULL,
    cover    TEXT NOT NULL DEFAULT '',
    status   TEXT NOT NULL DEFAULT 'planned',
    progress INTEGER NOT NULL DEFAULT 0,
    owner    INTEGER NOT NULL REFERENCES users(id),
    created  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    book     INTEGER NOT NULL REFERENCES books(id),
    user     INTEGER NOT NULL REFERENCES users(id),
    stars    INTEGER NOT NULL,
    story_stars INTEGER,
    text     TEXT NOT NULL,
    created  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    book     INTEGER NOT NULL REFERENCES books(id),
    user     INTEGER NOT NULL REFERENCES users(id),
    text     TEXT NOT NULL,
    page     INTEGER NOT NULL,
    created  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quote_likes (
    quote INTEGER NOT NULL REFERENCES quotes(id),
    user  INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (quote, user)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    quote    INTEGER NOT NULL REFERENCES quotes(id),
    user     INTEGER NOT NULL REFERENCES users(id),
    parent   INTEGER REFERENCES comments(id),
    text     TEXT NOT NULL,
    created  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reading (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user       INTEGER NOT NULL REFERENCES users(id),
    book       INTEGER NOT NULL REFERENCES books(id),
    status     TEXT NOT NULL DEFAULT 'planned',
    progress   INTEGER NOT NULL DEFAULT 0,
    format     TEXT NOT NULL DEFAULT 'Электронная',
    started_at TEXT,
    finished_at TEXT,
    created    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user, book)
  );
`);
/* Миграция: добавляем колонку role, если её нет */
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch (e) {}
/* Миграция: добавляем колонку story_stars в reviews */
try { db.exec("ALTER TABLE reviews ADD COLUMN story_stars INTEGER"); } catch (e) {}
/* Миграция: переносим старые глобальные статусы книг в личный прогресс (reading) */
(function migrateReading() {
  const books = db.prepare(`
    SELECT b.* FROM books b
    WHERE NOT EXISTS (SELECT 1 FROM reading r WHERE r.book = b.id AND r.user = b.owner)
  `).all();
  if (!books.length) return;
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT INTO reading (user,book,status,progress,format,started_at,finished_at) VALUES (?,?,?,?,?,?,?)`);
  for (const b of books) {
    ins.run(b.owner, b.id, b.status || 'planned', b.progress || 0, 'Электронная',
      (b.status === 'reading') ? now : null, (b.status === 'done') ? now : null);
  }
  console.log(`Миграция: создано ${books.length} записей чтения`);
})();

/* ===================== UTIL ===================== */
function userPublic(u) {
  return { id: u.id, name: u.name, email: u.email, color: u.color, active: !!u.active, role: u.role || 'user' };
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}
function requireAdmin(req, res, next) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Нужны права администратора' });
  next();
}
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ===================== SEED (demo data) ===================== */
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const demo = db.prepare('INSERT INTO users (name,email,pass,color) VALUES (?,?,?,?)')
    .run('Аня', 'anya@demo.ru', bcrypt.hashSync('demo1234', 10), '#9D4EDD');
  const uid = demo.lastInsertRowid;
  db.prepare('INSERT INTO users (name,email,pass,color) VALUES (?,?,?,?)')
    .run('Марк', 'mark@demo.ru', bcrypt.hashSync('demo1234', 10), '#00F5D4');
  const mark = db.prepare('SELECT id FROM users WHERE email=?').get('mark@demo.ru').id;
  db.prepare('INSERT INTO users (name,email,pass,color) VALUES (?,?,?,?)')
    .run('Лера', 'lera@demo.ru', bcrypt.hashSync('demo1234', 10), '#FF007F');
  const ins = db.prepare('INSERT INTO books (title,author,genre,pages,status,progress,owner) VALUES (?,?,?,?,?,?,?)');
  const b1984 = ins.run('1984', 'Джордж Оруэлл', 'Классика', 328, 'reading', 214, uid).lastInsertRowid;
  const bdune = ins.run('Дюна', 'Фрэнк Герберт', 'Фантастика', 687, 'done', 687, mark).lastInsertRowid;
  ins.run('Мастер и Маргарита', 'Михаил Булгаков', 'Роман', 480, 'reading', 120, uid);
  ins.run('Sapiens', 'Юваль Харари', 'Научпоп', 496, 'planned', 0, mark);
  const q = db.prepare('INSERT INTO quotes (book,user,text,page) VALUES (?,?,?,?)');
  const q1 = q.run(b1984, uid, 'Война — это мир. Свобода — это рабство. Незнание — это сила.', 5).lastInsertRowid;
  const q2 = q.run(bdune, mark, 'Страх убивает разум. Страх — это маленькая смерть, приносящая полное уничтожение.', 12).lastInsertRowid;
  q.run(b1984, uid, 'Рукописи не горят.', 240);
  db.prepare('INSERT INTO quote_likes (quote,user) VALUES (?,?)').run(q1, mark);
  db.prepare('INSERT INTO quote_likes (quote,user) VALUES (?,?)').run(q2, uid);
  const c = db.prepare('INSERT INTO comments (quote,user,text) VALUES (?,?,?)');
  c.run(q1, mark, 'Лучшая цитата в книге!');
  c.run(q2, uid, 'Цитата дня точно.');
  const r = db.prepare('INSERT INTO reviews (book,user,stars,story_stars,text) VALUES (?,?,?,?,?)');
  r.run(bdune, uid, 5, 5, 'Эпос мирового масштаба. Мир пустыни затягивает целиком.');
  console.log('Демо-данные созданы. Вход: anya@demo.ru / demo1234');
}
seed();

/* Гарантируем наличие учётки администратора */
(function ensureAdmin() {
  const a = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (a) return;
  db.prepare('INSERT INTO users (name,email,pass,color,role) VALUES (?,?,?,?,?)')
    .run('Администратор', 'admin@nocturnal.local', bcrypt.hashSync('admin1234', 10), '#FFB703', 'admin');
  console.log('Создана учётка администратора: admin@nocturnal.local / admin1234');
})();

/* ===================== APP ===================== */
const app = express();
app.use(express.json({ limit: '15mb' }));
/* Не кэшировать HTML, чтобы обновления сразу доходили до браузера */
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(__dirname));

/* ---------- AUTH ---------- */
app.post('/api/register', asyncH(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Пользователь с такой почтой уже существует' });
  const colors = ['#9D4EDD', '#00F5D4', '#FF007F', '#7A5CFF', '#00B3A4', '#FF4D8D', '#FFB703'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare('INSERT INTO users (name,email,pass,color) VALUES (?,?,?,?)')
    .run(name.trim(), email.toLowerCase(), hash, color);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user: userPublic(user) });
}));

app.post('/api/login', asyncH(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Заполните все поля' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.pass))
    return res.status(401).json({ error: 'Неверная почта или пароль' });
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: userPublic(user) });
}));

app.get('/api/me', auth, asyncH(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json(userPublic(user));
}));

/* ---------- USERS ---------- */
app.get('/api/users', asyncH(async (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
  res.json(rows.map(userPublic));
}));

app.delete('/api/users/:id', auth, requireAdmin, asyncH(async (req, res) => {
  const target = +req.params.id;
  if (target === req.user.id) return res.status(400).json({ error: 'Нельзя удалить собственную учётку' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(target);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  db.exec('BEGIN');
  try {
    const books = db.prepare('SELECT id FROM books WHERE owner = ?').all(target);
    const delC = db.prepare('DELETE FROM comments WHERE quote = ?');
    const delL = db.prepare('DELETE FROM quote_likes WHERE quote = ?');
    for (const b of books) {
      const qs = db.prepare('SELECT id FROM quotes WHERE book = ?').all(b.id);
      for (const q of qs) { delC.run(q.id); delL.run(q.id); }
      db.prepare('DELETE FROM quotes WHERE book = ?').run(b.id);
      db.prepare('DELETE FROM reviews WHERE book = ?').run(b.id);
    }
    db.prepare('DELETE FROM books WHERE owner = ?').run(target);
    db.prepare('DELETE FROM comments WHERE user = ?').run(target);
    db.prepare('DELETE FROM quote_likes WHERE user = ?').run(target);
    db.prepare('DELETE FROM reviews WHERE user = ?').run(target);
    db.prepare('DELETE FROM quotes WHERE user = ?').run(target);
    db.prepare('DELETE FROM reading WHERE user = ?').run(target);
    db.prepare('DELETE FROM users WHERE id = ?').run(target);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
}));

/* ---------- BOOKS ---------- */
function bookSummary() {
  const books = db.prepare(`
    SELECT b.*, u.name AS owner_name, u.color AS owner_color,
      (SELECT COUNT(*) FROM reviews r WHERE r.book = b.id) AS reviews_count
    FROM books b JOIN users u ON u.id = b.owner ORDER BY b.id DESC
  `).all();
  const ids = books.map(b => b.id);
  let readings = [];
  if (ids.length) {
    readings = db.prepare(`SELECT r.*, u.name AS user_name, u.color AS user_color
      FROM reading r JOIN users u ON u.id = r.user
      WHERE r.book IN (${ids.map(() => '?').join(',')})
      ORDER BY r.id ASC`).all(...ids);
  }
  const byBook = {};
  for (const r of readings) {
    if (!byBook[r.book]) byBook[r.book] = [];
    byBook[r.book].push({
      user_id: r.user, user_name: r.user_name, user_color: r.user_color,
      status: r.status, progress: r.progress, format: r.format,
      started_at: r.started_at, finished_at: r.finished_at,
    });
  }
  for (const b of books) {
    b.readers = byBook[b.id] || [];
    b.reading_count = (b.readers||[]).filter(x => x.status === 'reading').length;
    b.done_count = (b.readers||[]).filter(x => x.status === 'done').length;
    b.planned_count = (b.readers||[]).filter(x => x.status === 'planned').length;
  }
  return books;
}

app.get('/api/books', asyncH(async (req, res) => {
  res.json(bookSummary());
}));

app.post('/api/books', auth, asyncH(async (req, res) => {
  const { title, author, genre, pages, cover, status, format } = req.body || {};
  if (!title || !pages) return res.status(400).json({ error: 'Название и страницы обязательны' });
  const newStatus = status || 'planned';
  const r = db.prepare(
    'INSERT INTO books (title,author,genre,pages,cover,status,progress,owner) VALUES (?,?,?,?,?,?,?,?)'
  ).run(title.trim(), author || 'Неизвестный автор', genre || 'Классика',
    +pages, cover || '', newStatus, newStatus === 'done' ? +pages : 0, req.user.id);
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(r.lastInsertRowid);
  // Создаём личную запись чтения для владельца
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO reading (user,book,status,progress,format,started_at,finished_at) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user.id, book.id, newStatus, newStatus === 'done' ? +pages : 0, format || 'Электронная',
      newStatus === 'reading' ? now : null, newStatus === 'done' ? now : null);
  res.status(201).json(book);
}));

app.patch('/api/books/:id', auth, asyncH(async (req, res) => {
  const b = db.prepare('SELECT * FROM books WHERE id = ?').get(+req.params.id);
  if (!b) return res.status(404).json({ error: 'Не найдена' });
  const { progress, status, cover, format, started_at, finished_at } = req.body || {};
  if (progress !== undefined && (isNaN(+progress) || +progress < 0 || +progress > b.pages))
    return res.status(400).json({ error: 'Некорректный прогресс' });
  let newCover = b.cover;
  if (cover !== undefined) {
    if (typeof cover !== 'string') return res.status(400).json({ error: 'Некорректная обложка' });
    newCover = cover;
  }
  if (cover !== undefined) {
    db.prepare('UPDATE books SET cover = ? WHERE id = ?').run(newCover, b.id);
  }
  // Личный прогресс/статус в таблице reading
  if (progress !== undefined || status !== undefined || format !== undefined || started_at !== undefined || finished_at !== undefined) {
    const cur = db.prepare('SELECT * FROM reading WHERE user = ? AND book = ?').get(req.user.id, b.id);
    if (!cur) {
      // если записи нет — создаём
      const now = new Date().toISOString();
      const st = status || 'planned';
      db.prepare(`INSERT INTO reading (user,book,status,progress,format,started_at,finished_at) VALUES (?,?,?,?,?,?,?)`)
        .run(req.user.id, b.id, st, (progress !== undefined ? +progress : 0),
          format || 'Электронная', started_at !== undefined ? started_at : (st === 'reading' ? now : null), finished_at !== undefined ? finished_at : (st === 'done' ? now : null));
    } else {
      const newProgress = progress !== undefined ? +progress : cur.progress;
      const newStatus = status || cur.status;
      const newFormat = format || cur.format;
      const finalProgress = newStatus === 'done' ? b.pages : newProgress;
      const now = new Date().toISOString();
      let started = started_at !== undefined ? started_at : cur.started_at;
      let finished = finished_at !== undefined ? finished_at : cur.finished_at;
      if (started_at === null) started = null;
      if (finished_at === null) finished = null;
      if (newStatus === 'reading' && !started) started = now;
      if (newStatus === 'done' && !finished) finished = now;
      if (newStatus !== 'done' && finished && finished_at === undefined) finished = null;
      db.prepare(`UPDATE reading SET status=?, progress=?, format=?, started_at=?, finished_at=? WHERE user=? AND book=?`)
        .run(newStatus, finalProgress, newFormat, started, finished, req.user.id, b.id);
    }
    // поддерживаем глобальный статус книги (для дашборда) из сводки читателей
    const summary = db.prepare(`SELECT
        SUM(CASE WHEN status='reading' THEN 1 ELSE 0 END) AS rd,
        SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS dn,
        SUM(CASE WHEN status='planned' THEN 1 ELSE 0 END) AS pl,
        MAX(progress) AS mx
      FROM reading WHERE book = ?`).get(b.id);
    const gStatus = (summary.dn > 0) ? 'done' : ((summary.rd > 0) ? 'reading' : 'planned');
    const gProgress = summary.mx || 0;
    db.prepare('UPDATE books SET status = ?, progress = ? WHERE id = ?').run(gStatus, gProgress, b.id);
  }
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(b.id);
  res.json(book);
}));

app.delete('/api/books/:id', auth, asyncH(async (req, res) => {
  const b = db.prepare('SELECT * FROM books WHERE id = ?').get(+req.params.id);
  if (!b) return res.status(404).json({ error: 'Не найдена' });
  if (b.owner !== req.user.id) return res.status(403).json({ error: 'Можно удалять только свои книги' });
  const qs = db.prepare('SELECT id FROM quotes WHERE book = ?').all(b.id);
  db.exec('BEGIN');
  try {
    const delC = db.prepare('DELETE FROM comments WHERE quote = ?');
    const delL = db.prepare('DELETE FROM quote_likes WHERE quote = ?');
    for (const q of qs) { delC.run(q.id); delL.run(q.id); }
    db.prepare('DELETE FROM quotes WHERE book = ?').run(b.id);
    db.prepare('DELETE FROM reviews WHERE book = ?').run(b.id);
    db.prepare('DELETE FROM reading WHERE book = ?').run(b.id);
    db.prepare('DELETE FROM books WHERE id = ?').run(b.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
}));

/* ---------- REVIEWS ---------- */
app.post('/api/books/:id/reviews', auth, asyncH(async (req, res) => {
  const { stars, story_stars, text } = req.body || {};
  if (!text || !stars || +stars < 1 || +stars > 5) return res.status(400).json({ error: 'Некорректный отзыв' });
  if (story_stars !== undefined && (isNaN(+story_stars) || +story_stars < 0 || +story_stars > 5))
    return res.status(400).json({ error: 'Некорректная оценка сюжета' });
  const b = db.prepare('SELECT id FROM books WHERE id = ?').get(+req.params.id);
  if (!b) return res.status(404).json({ error: 'Книга не найдена' });
  const r = db.prepare('INSERT INTO reviews (book,user,stars,story_stars,text) VALUES (?,?,?,?,?)')
    .run(b.id, req.user.id, +stars, story_stars !== undefined ? +story_stars : null, text.trim());
  const rev = db.prepare(`SELECT r.*, u.name AS user_name, u.color AS user_color
    FROM reviews r JOIN users u ON u.id = r.user WHERE r.id = ?`).get(r.lastInsertRowid);
  res.status(201).json(rev);
}));

app.get('/api/books/:id/reviews', asyncH(async (req, res) => {
  const rows = db.prepare(`SELECT r.*, u.name AS user_name, u.color AS user_color
    FROM reviews r JOIN users u ON u.id = r.user WHERE r.book = ? ORDER BY r.id DESC`).all(+req.params.id);
  res.json(rows);
}));

app.get('/api/books/:id/readers', asyncH(async (req, res) => {
  const bookId = +req.params.id;
  const readers = db.prepare(`SELECT r.*, u.name AS user_name, u.color AS user_color
    FROM reading r JOIN users u ON u.id = r.user WHERE r.book = ? ORDER BY
      CASE r.status WHEN 'reading' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, r.id ASC`).all(bookId);
  const reviews = db.prepare(`SELECT r.*, u.name AS user_name, u.color AS user_color
    FROM reviews r JOIN users u ON u.id = r.user WHERE r.book = ? ORDER BY r.id DESC`).all(bookId);
  res.json({ readers, reviews });
}));

/* ---------- QUOTES ---------- */
app.get('/api/quotes', asyncH(async (req, res) => {
  const quotes = db.prepare(`
    SELECT q.*, b.title AS book_title, b.author AS book_author,
      u.name AS user_name, u.color AS user_color,
      (SELECT COUNT(*) FROM quote_likes ql WHERE ql.quote = q.id) AS likes,
      (SELECT COUNT(*) FROM comments c WHERE c.quote = q.id) AS comments_count
    FROM quotes q
    JOIN books b ON b.id = q.book
    JOIN users u ON u.id = q.user
    ORDER BY q.id DESC
  `).all();
  const ids = quotes.map(q => q.id);
  let likers = {};
  if (ids.length) {
    const rows = db.prepare(`SELECT ql.quote, u.id, u.name, u.color FROM quote_likes ql JOIN users u ON u.id = ql.user
      WHERE ql.quote IN (${ids.map(() => '?').join(',')})`).all(...ids);
    likers = rows.reduce((acc, r) => {
      (acc[r.quote] = acc[r.quote] || []).push({ id: r.id, name: r.name, color: r.color });
      return acc;
    }, {});
  }
  quotes.forEach(q => { q.likers = likers[q.id] || []; });
  res.json(quotes);
}));

app.post('/api/quotes', auth, asyncH(async (req, res) => {
  const { book, text, page } = req.body || {};
  if (!book || !text) return res.status(400).json({ error: 'Книга и текст обязательны' });
  const b = db.prepare('SELECT id FROM books WHERE id = ?').get(+book);
  if (!b) return res.status(404).json({ error: 'Книга не найдена' });
  const r = db.prepare('INSERT INTO quotes (book,user,text,page) VALUES (?,?,?,?)')
    .run(b.id, req.user.id, text.trim(), +page || 1);
  res.status(201).json({ id: r.lastInsertRowid });
}));

/* ---------- LIKE / COMMENT ---------- */
app.post('/api/quotes/:id/like', auth, asyncH(async (req, res) => {
  const q = db.prepare('SELECT id FROM quotes WHERE id = ?').get(+req.params.id);
  if (!q) return res.status(404).json({ error: 'Цитата не найдена' });
  const likes = req.body && req.body.liked !== undefined ? !!req.body.liked : true;
  if (likes) db.prepare('INSERT OR IGNORE INTO quote_likes (quote,user) VALUES (?,?)').run(q.id, req.user.id);
  else db.prepare('DELETE FROM quote_likes WHERE quote = ? AND user = ?').run(q.id, req.user.id);
  res.json({ ok: true, liked: likes });
}));

app.get('/api/quotes/:id/comments', asyncH(async (req, res) => {
  const rows = db.prepare(`SELECT c.*, u.name AS user_name, u.color AS user_color
    FROM comments c JOIN users u ON u.id = c.user WHERE c.quote = ? ORDER BY c.id ASC`).all(+req.params.id);
  res.json(rows);
}));

app.post('/api/quotes/:id/comments', auth, asyncH(async (req, res) => {
  const q = db.prepare('SELECT id FROM quotes WHERE id = ?').get(+req.params.id);
  if (!q) return res.status(404).json({ error: 'Цитата не найдена' });
  const { text, parent } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Введите текст' });
  const r = db.prepare('INSERT INTO comments (quote,user,parent,text) VALUES (?,?,?,?)')
    .run(q.id, req.user.id, parent || null, text.trim());
  const c = db.prepare(`SELECT c.*, u.name AS user_name, u.color AS user_color
    FROM comments c JOIN users u ON u.id = c.user WHERE c.id = ?`).get(r.lastInsertRowid);
  res.status(201).json(c);
}));

/* ---------- ACTIVITY ---------- */
app.get('/api/activity', asyncH(async (req, res) => {
  const acts = [];
  db.prepare(`SELECT b.*, u.name AS uname FROM books b JOIN users u ON u.id=b.owner ORDER BY b.id DESC LIMIT 4`)
    .all().forEach(b => acts.push({ type: 'book', text: `${b.uname} добавил «${b.title}»`, at: b.created }));
  db.prepare(`SELECT q.*, u.name AS uname FROM quotes q JOIN users u ON u.id=q.user ORDER BY q.id DESC LIMIT 4`)
    .all().forEach(q => acts.push({ type: 'quote', text: `${q.uname} поделился цитатой`, at: q.created }));
  db.prepare(`SELECT c.*, u.name AS uname FROM comments c JOIN users u ON u.id=c.user ORDER BY c.id DESC LIMIT 4`)
    .all().forEach(c => acts.push({ type: 'comment', text: `${c.uname} оставил комментарий`, at: c.created }));
  acts.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json(acts.slice(0, 8));
}));

/* ---------- EXPORT / IMPORT (бэкап данных) ---------- */
app.get('/api/backup/export', auth, requireAdmin, asyncH(async (req, res) => {
  const dump = {
    exportedAt: new Date().toISOString(),
    users: db.prepare('SELECT * FROM users').all(),
    books: db.prepare('SELECT * FROM books').all(),
    reviews: db.prepare('SELECT * FROM reviews').all(),
    quotes: db.prepare('SELECT * FROM quotes').all(),
    quote_likes: db.prepare('SELECT * FROM quote_likes').all(),
    comments: db.prepare('SELECT * FROM comments').all(),
    reading: db.prepare('SELECT * FROM reading').all(),
  };
  res.set('Content-Disposition', 'attachment; filename="nocturnal-backup.json"');
  res.set('Content-Type', 'application/json');
  res.json(dump);
}));

app.post('/api/backup/import', auth, requireAdmin, asyncH(async (req, res) => {
  const d = req.body && req.body.data;
  if (!d || !Array.isArray(d.users) || !Array.isArray(d.books))
    return res.status(400).json({ error: 'Некорректный файл бэкапа' });
  db.exec('BEGIN');
  try {
    // Очищаем все таблицы (порядок: дочерние к родительским)
    db.exec(`
      DELETE FROM comments;
      DELETE FROM quote_likes;
      DELETE FROM quotes;
      DELETE FROM reviews;
      DELETE FROM reading;
      DELETE FROM books;
      DELETE FROM users;
    `);
    const insUser = db.prepare('INSERT INTO users (id,name,email,pass,color,role,active,created) VALUES (?,?,?,?,?,?,?,?)');
    for (const u of d.users) insUser.run(u.id, u.name, u.email, u.pass, u.color, u.role || 'user', u.active == null ? 1 : u.active, u.created);
    const insBook = db.prepare('INSERT INTO books (id,title,author,genre,pages,cover,status,progress,owner,created) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const b of d.books) insBook.run(b.id, b.title, b.author, b.genre, b.pages, b.cover || '', b.status || 'planned', b.progress || 0, b.owner, b.created);
    const insRev = db.prepare('INSERT INTO reviews (id,book,user,stars,story_stars,text,created) VALUES (?,?,?,?,?,?,?)');
    for (const r of (d.reviews || [])) insRev.run(r.id, r.book, r.user, r.stars, r.story_stars || null, r.text, r.created);
    const insQ = db.prepare('INSERT INTO quotes (id,book,user,text,page,created) VALUES (?,?,?,?,?,?)');
    for (const q of (d.quotes || [])) insQ.run(q.id, q.book, q.user, q.text, q.page, q.created);
    const insL = db.prepare('INSERT INTO quote_likes (quote,user) VALUES (?,?)');
    for (const l of (d.quote_likes || [])) insL.run(l.quote, l.user);
    const insC = db.prepare('INSERT INTO comments (id,quote,user,parent,text,created) VALUES (?,?,?,?,?,?)');
    for (const c of (d.comments || [])) insC.run(c.id, c.quote, c.user, c.parent || null, c.text, c.created);
    const insR = db.prepare('INSERT INTO reading (id,user,book,status,progress,format,started_at,finished_at,created) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const r of (d.reading || [])) insR.run(r.id, r.user, r.book, r.status || 'planned', r.progress || 0, r.format || 'Электронная', r.started_at || null, r.finished_at || null, r.created);
    // Сбрасываем AUTOINCREMENT на следующий id
    db.exec(`UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM ${'users'}) WHERE name = 'users';`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
}));

/* ---------- ERROR + FALLBACK ---------- */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`Nocturnal работает на http://localhost:${PORT}`);
});
