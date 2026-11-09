require('dotenv').config();
const express        = require('express');
const mysql          = require('mysql2/promise');
const QRCode         = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path           = require('path');
const fs             = require('fs');
const os             = require('os');

// ── Get local IP (for local dev) ─────────────────────────
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal)
        candidates.push({ name, address: iface.address });
    }
  }
  const real = candidates.find(c =>
    !c.name.toLowerCase().includes('virtual') &&
    !c.name.toLowerCase().includes('vmware') &&
    !c.name.toLowerCase().includes('vbox') &&
    (c.address.startsWith('10.') || c.address.startsWith('192.168.') || c.address.startsWith('172.'))
  );
  const ip = real ? real.address : (candidates[0]?.address || 'localhost');
  return ip === '192.168.56.1' ? '10.170.153.13' : ip;
}

const PORT     = process.env.PORT || 3000;
const LOCAL_IP = getLocalIP();

// Railway sets RAILWAY_PUBLIC_DOMAIN automatically
// LOCAL: use IP, RAILWAY: use the public domain
let BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.PUBLIC_URL || `http://${LOCAL_IP}:${PORT}`);

// ── Express ──────────────────────────────────────────────
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// QR codes folder — use /tmp on Railway (ephemeral), public/qrcodes locally
const isRailway = !!process.env.RAILWAY_PUBLIC_DOMAIN;
const qrDir = isRailway
  ? path.join('/tmp', 'qrcodes')
  : path.join(__dirname, 'public', 'qrcodes');

if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

// Serve QR codes from /tmp on Railway
if (isRailway) {
  app.use('/qrcodes', express.static('/tmp/qrcodes'));
}

// ── MySQL Pool ───────────────────────────────────────────
let db;
async function initDB() {
  // Railway provides MYSQL_URL or individual vars
  let connectionConfig;

  if (process.env.MYSQL_URL || process.env.DATABASE_URL) {
    // Railway MySQL plugin gives a full URL
    connectionConfig = { uri: process.env.MYSQL_URL || process.env.DATABASE_URL };
  } else {
    connectionConfig = {
      host:     process.env.DB_HOST     || 'localhost',
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || '',
      port:     process.env.DB_PORT     || 3306,
    };
  }

  // Create database if not exists (local dev only)
  if (!process.env.MYSQL_URL && !process.env.DATABASE_URL) {
    const tmp = await mysql.createConnection(connectionConfig);
    await tmp.execute(
      `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'classroom_portal'}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await tmp.end();
    connectionConfig.database = process.env.DB_NAME || 'classroom_portal';
  }

  db = await mysql.createPool({
    ...connectionConfig,
    waitForConnections: true,
    connectionLimit:    10,
    ssl: process.env.MYSQL_URL ? { rejectUnauthorized: false } : undefined,
  });

  // Create tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS classrooms (
      id          VARCHAR(36)  PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      building    VARCHAR(255) DEFAULT '',
      floor       VARCHAR(100) DEFAULT '',
      description TEXT,
      qr_path     VARCHAR(500),
      created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS assets (
      id               VARCHAR(36)  PRIMARY KEY,
      classroom_id     VARCHAR(36)  NOT NULL,
      name             VARCHAR(255) NOT NULL,
      type             VARCHAR(100) NOT NULL,
      quantity         INT          NOT NULL DEFAULT 1,
      condition_status VARCHAR(100) NOT NULL,
      description      TEXT,
      created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
    )
  `);

  console.log('✅ MySQL connected — tables ready');
}

// ── QR Helper ────────────────────────────────────────────
async function generateClassroomQR(classroomId) {
  const qrUrl      = `${BASE_URL}/classroom/${classroomId}?scan=1`;
  const qrFileName = `classroom_${classroomId}.png`;
  const qrFilePath = path.join(qrDir, qrFileName);
  await QRCode.toFile(qrFilePath, qrUrl, {
    color: { dark: '#1a1a2e', light: '#ffffff' },
    width: 300, margin: 2
  });
  return `/qrcodes/${qrFileName}`;
}

// ════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════
app.get('/settings', (req, res) => {
  res.render('settings', { baseUrl: BASE_URL, success: null, error: null });
});

app.post('/settings', async (req, res) => {
  const newUrl = (req.body.public_url || '').trim().replace(/\/$/, '');
  if (!newUrl) return res.render('settings', { baseUrl: BASE_URL, success: null, error: 'URL cannot be empty!' });
  BASE_URL = newUrl;
  const [classrooms] = await db.execute('SELECT id FROM classrooms');
  for (const c of classrooms) {
    const qrUrl = `${BASE_URL}/classroom/${c.id}?scan=1`;
    await QRCode.toFile(path.join(qrDir, `classroom_${c.id}.png`), qrUrl, {
      color: { dark: '#1a1a2e', light: '#ffffff' }, width: 300, margin: 2
    });
  }
  res.render('settings', { baseUrl: BASE_URL, success: `✅ Updated! ${classrooms.length} QR code(s) regenerated.`, error: null });
});

// ════════════════════════════════════════════════════════
//  HOME
// ════════════════════════════════════════════════════════
app.get('/', async (req, res) => {
  const [classrooms] = await db.execute(`
    SELECT c.*, COUNT(a.id) AS asset_count
    FROM classrooms c
    LEFT JOIN assets a ON a.classroom_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `);
  res.render('index', { classrooms });
});

// ════════════════════════════════════════════════════════
//  ADD CLASSROOM
// ════════════════════════════════════════════════════════
app.get('/classroom/new', (req, res) => {
  res.render('classroom-form', { classroom: null, error: null });
});

app.post('/classroom/new', async (req, res) => {
  const { name, building, floor, description } = req.body;
  if (!name) return res.render('classroom-form', { classroom: null, error: 'Classroom name required!' });
  const id      = uuidv4();
  const qr_path = await generateClassroomQR(id);
  await db.execute(
    'INSERT INTO classrooms (id, name, building, floor, description, qr_path) VALUES (?,?,?,?,?,?)',
    [id, name, building||'', floor||'', description||'', qr_path]
  );
  res.redirect('/');
});

// ════════════════════════════════════════════════════════
//  VIEW CLASSROOM
// ════════════════════════════════════════════════════════
app.get('/classroom/:id', async (req, res) => {
  const [[classroom]] = await db.execute('SELECT * FROM classrooms WHERE id=?', [req.params.id]);
  if (!classroom) return res.status(404).render('404');
  const [assets] = await db.execute(
    'SELECT * FROM assets WHERE classroom_id=? ORDER BY type ASC', [req.params.id]
  );
  const scanMode = req.query.scan === '1';
  res.render('classroom', { classroom, assets, isNew: req.query.new === '1', scanMode });
});

// ════════════════════════════════════════════════════════
//  EDIT CLASSROOM
// ════════════════════════════════════════════════════════
app.get('/classroom/:id/edit', async (req, res) => {
  const [[classroom]] = await db.execute('SELECT * FROM classrooms WHERE id=?', [req.params.id]);
  if (!classroom) return res.status(404).render('404');
  res.render('classroom-form', { classroom, error: null });
});

app.post('/classroom/:id/edit', async (req, res) => {
  const { name, building, floor, description } = req.body;
  await db.execute(
    'UPDATE classrooms SET name=?, building=?, floor=?, description=? WHERE id=?',
    [name, building||'', floor||'', description||'', req.params.id]
  );
  res.redirect(`/classroom/${req.params.id}`);
});

// ════════════════════════════════════════════════════════
//  DELETE CLASSROOM
// ════════════════════════════════════════════════════════
app.post('/classroom/:id/delete', async (req, res) => {
  const [[classroom]] = await db.execute('SELECT * FROM classrooms WHERE id=?', [req.params.id]);
  if (classroom) {
    const qrFile = path.join(qrDir, `classroom_${req.params.id}.png`);
    if (fs.existsSync(qrFile)) fs.unlinkSync(qrFile);
    await db.execute('DELETE FROM classrooms WHERE id=?', [req.params.id]);
  }
  res.redirect('/');
});

// ════════════════════════════════════════════════════════
//  ADD ASSET
// ════════════════════════════════════════════════════════
app.get('/classroom/:id/asset/new', async (req, res) => {
  const [[classroom]] = await db.execute('SELECT * FROM classrooms WHERE id=?', [req.params.id]);
  if (!classroom) return res.status(404).render('404');
  res.render('asset-form', { classroom, asset: null, error: null });
});

app.post('/classroom/:id/asset/new', async (req, res) => {
  const { name, type, quantity, condition, description } = req.body;
  if (!name || !type || !quantity || !condition) {
    const [[classroom]] = await db.execute('SELECT * FROM classrooms WHERE id=?', [req.params.id]);
    return res.render('asset-form', { classroom, asset: null, error: 'All required fields must be filled!' });
  }
  try {
    await db.execute(
      'INSERT INTO assets (id, classroom_id, name, type, quantity, condition_status, description) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), req.params.id, name, type, parseInt(quantity), condition, description||'']
    );
    res.redirect(`/classroom/${req.params.id}?new=1`);
  } catch (err) {
    console.error('❌ Asset insert error:', err.message);
    const [[classroom]] = await db.execute('SELECT * FROM classrooms WHERE id=?', [req.params.id]);
    res.render('asset-form', { classroom, asset: null, error: 'Error: ' + err.message });
  }
});

// ════════════════════════════════════════════════════════
//  EDIT ASSET
// ════════════════════════════════════════════════════════
app.get('/asset/:id/edit', async (req, res) => {
  const [[asset]] = await db.execute('SELECT * FROM assets WHERE id=?', [req.params.id]);
  if (!asset) return res.status(404).render('404');
  const [[classroom]] = await db.execute('SELECT * FROM classrooms WHERE id=?', [asset.classroom_id]);
  res.render('asset-form', { classroom, asset, error: null });
});

app.post('/asset/:id/edit', async (req, res) => {
  const { name, type, quantity, condition, description } = req.body;
  const [[asset]] = await db.execute('SELECT classroom_id FROM assets WHERE id=?', [req.params.id]);
  await db.execute(
    'UPDATE assets SET name=?, type=?, quantity=?, condition_status=?, description=? WHERE id=?',
    [name, type, parseInt(quantity), condition, description||'', req.params.id]
  );
  res.redirect(`/classroom/${asset.classroom_id}`);
});

// ════════════════════════════════════════════════════════
//  DELETE ASSET
// ════════════════════════════════════════════════════════
app.post('/asset/:id/delete', async (req, res) => {
  const [[asset]] = await db.execute('SELECT classroom_id FROM assets WHERE id=?', [req.params.id]);
  if (asset) {
    await db.execute('DELETE FROM assets WHERE id=?', [req.params.id]);
    res.redirect(`/classroom/${asset.classroom_id}`);
  } else {
    res.redirect('/');
  }
});

// ════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Classroom Portal running!`);
    console.log(`   Local    : http://localhost:${PORT}`);
    if (!isRailway) console.log(`   Network  : http://${LOCAL_IP}:${PORT}`);
    console.log(`   Base URL : ${BASE_URL}\n`);
  });
}).catch(err => {
  console.error('\n❌ MySQL connection failed:', err.message);
  process.exit(1);
});
