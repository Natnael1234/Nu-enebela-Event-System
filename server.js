'use strict';

const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const bcrypt      = require('bcryptjs');
const multer      = require('multer');
const crypto      = require('crypto');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

// ─── Security headers ────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const _rl = new Map();
setInterval(() => { const n = Date.now(); _rl.forEach((v, k) => { if (n > v.r) _rl.delete(k); }); }, 60_000);

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || '?';
    const key = `${ip}|${req.path}`;
    const now = Date.now();
    let e = _rl.get(key);
    if (!e || now > e.r) e = { c: 0, r: now + windowMs };
    e.c++;
    _rl.set(key, e);
    if (e.c > max) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    next();
  };
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: false, limit: '512kb' }));
app.use('/images',  express.static(path.join(ROOT, 'Images')));
app.use('/uploads', express.static(UPLOADS_DIR));
// CSS, JS, and other assets served from public/
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1m', index: false }));

// ─── Multer configs ───────────────────────────────────────────────────────────
function diskStorage(folder) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(UPLOADS_DIR, folder)),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      cb(null, `${crypto.randomBytes(8).toString('hex')}_${safe}`);
    },
  });
}

const uploadPayment = multer({
  storage: diskStorage('payments'),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files accepted.'));
    cb(null, true);
  },
});

const uploadMedia = multer({
  storage: diskStorage('gameplay'),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const uploadGameMedia = multer({
  storage: diskStorage('games'),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/')) {
      return cb(new Error('Only image or video files accepted.'));
    }
    cb(null, true);
  },
});

// ─── Default DB ───────────────────────────────────────────────────────────────
const DEFAULT_DB = {
  settings: {
    ticketPriceBirr: 200,
    paymentMethods: {
      telebirr: '0900000000',
      cbe: '1000123456789',
      holderName: 'SaNex Realities',
    },
    missedInsertEvery: 4,
  },
  admins: [],
  users: [],
  feedback: [],
  games: [
    {
      id: 'station_1',
      stationNumber: 1,
      name: 'VR Experience Alpha',
      description: 'Dive into a fast-paced immersive VR action challenge at Station 1.',
      imagePath: '',
      videoPath: '',
      active: true,
    },
    {
      id: 'station_2',
      stationNumber: 2,
      name: 'VR Experience Beta',
      description: 'Explore a deep mixed-reality survival adventure at Station 2.',
      imagePath: '',
      videoPath: '',
      active: true,
    },
  ],
  bookings: [],
  sessions: [],
  gameQueues: {
    station_1: { currentBookingId: null, lastCompletedBookingId: null, cycleCounter: 0 },
    station_2: { currentBookingId: null, lastCompletedBookingId: null, cycleCounter: 0 },
  },
};

// ─── In-memory DB cache (declared here so initStorage can use readDb/writeDb) ─
let _dbCache    = null;
let _flushTimer = null;

initStorage();

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/info', (_req, res) => {
  const db = readDb();
  const counts = buildQueueCounts(db);
  res.json({
    games: db.games,
    ticketPriceBirr: db.settings.ticketPriceBirr,
    paymentMethods: db.settings.paymentMethods,
    queueCounts: counts,
  });
});

app.get('/api/queue/counts', (_req, res) => {
  const db = readDb();
  res.json(buildQueueCounts(db));
});

// ─── Public feedback (no auth required) ──────────────────────────────────────
app.post('/api/public-feedback',
  rateLimit(3, 30 * 60 * 1000),
  (req, res) => {
    const db = readDb();
    const rating = Number(req.body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Please select a rating between 1 and 5.' });
    }
    if (!db.feedback) db.feedback = [];
    db.feedback.push({
      id:        newId('pfbk'),
      bookingId: null,
      userId:    null,
      gameId:    null,
      type:      'public',
      guestName: sanitize(req.body.name || '').slice(0, 80),
      rating,
      comment:   sanitize(req.body.comment || '').slice(0, 400),
      createdAt: now(),
    });
    writeDb(db);
    res.status(201).json({ ok: true });
  }
);

app.get('/api/leaderboard', (_req, res) => {
  const db = readDb();

  function buildBoard(bookings) {
    return bookings
      .filter((b) => b.status === 'completed' && typeof b.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((b, i) => {
        const u = db.users.find((x) => x.id === b.userId);
        const g = db.games.find((x) => x.id === b.gameId);
        return { rank: i + 1, fullName: u?.fullName || '?', gameName: g?.name || '?', gameId: b.gameId, score: b.score };
      });
  }

  const overall = buildBoard(db.bookings);
  const byGame  = {};
  for (const game of db.games) {
    byGame[game.id] = buildBoard(db.bookings.filter((b) => b.gameId === game.id));
    byGame[game.id].forEach((e, i) => { e.rank = i + 1; });
  }

  res.json({ leaderboard: overall, byGame, games: db.games.map((g) => ({ id: g.id, name: g.name, stationNumber: g.stationNumber })) });
});

app.get('/api/display', (_req, res) => {
  const db = readDb();
  const stations = db.games.map((game) => {
    const current = getCurrentPlaying(db, game.id);
    const waiting = getWaiting(db, game.id).slice(0, 5).map((b) => expandBooking(db, b));
    return {
      gameId: game.id,
      gameName: game.name,
      stationNumber: game.stationNumber,
      currentPlaying: current ? expandBooking(db, current) : null,
      waiting,
    };
  });
  const leaderboard = db.bookings
    .filter((b) => b.status === 'completed' && typeof b.score === 'number')
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((b, i) => {
      const u = db.users.find((x) => x.id === b.userId);
      const g = db.games.find((x) => x.id === b.gameId);
      return { rank: i + 1, fullName: u?.fullName || '?', gameName: g?.name || '?', score: b.score };
    });
  res.json({ stations, leaderboard });
});

// ═════════════════════════════════════════════════════════════════════════════
//  CLIENT AUTH
// ═════════════════════════════════════════════════════════════════════════════

app.post('/api/client/register',
  rateLimit(5, 10 * 60 * 1000),
  (req, res) => {
    const db = readDb();
    const { fullName, phoneNumber, telegram, gameId } = req.body;

    if (!isNonEmptyStr(fullName) || !isNonEmptyStr(phoneNumber) || !isNonEmptyStr(gameId)) {
      return res.status(400).json({ error: 'Full name, phone number, and game selection are required.' });
    }

    const game = db.games.find((g) => g.id === gameId && g.active);
    if (!game) return res.status(400).json({ error: 'Selected game is not available.' });

    const normPhone = normalizePhone(phoneNumber);
    if (normPhone.length < 9 || normPhone.length > 15) {
      return res.status(400).json({ error: 'Enter a valid phone number.' });
    }

    const existing = db.users.find((u) => normalizePhone(u.phoneNumber) === normPhone);
    if (existing) {
      const activeBooking = db.bookings.find(
        (b) => b.userId === existing.id && isActiveStatus(b.status)
      );
      if (activeBooking) {
        return res.status(409).json({
          error: 'An account with this phone number already has an active booking.',
          hint: 'Use the Returning Player login with your Access ID.',
        });
      }
    }

    const user = existing
      ? (() => { existing.fullName = sanitize(fullName); existing.telegram = sanitize(telegram || ''); return existing; })()
      : (() => {
          const u = {
            id: newId('usr'),
            fullName: sanitize(fullName),
            phoneNumber: sanitize(phoneNumber),
            telegram: sanitize(telegram || ''),
            accessId: generateAccessId(),
            createdAt: now(),
          };
          db.users.push(u);
          return u;
        })();

    const booking = {
      id: newId('bkg'),
      userId: user.id,
      gameId,
      status: 'awaiting_payment',
      queueNumber: null,
      paymentProofPath: '',
      paymentRejectReason: '',
      score: null,
      gameplayMedia: [],
      missedCount: 0,
      createdAt: now(),
      paymentSubmittedAt: null,
      approvedAt: null,
      startedAt: null,
      completedAt: null,
      missedAt: null,
    };

    db.bookings.push(booking);
    const token = createSession(db, 'client', user.id);
    writeDb(db);

    res.status(201).json({
      token,
      accessId: user.accessId,
      booking: expandBooking(db, booking),
      ticketPriceBirr: db.settings.ticketPriceBirr,
      paymentMethods: db.settings.paymentMethods,
    });
  }
);

app.post('/api/client/access',
  rateLimit(10, 10 * 60 * 1000),
  (req, res) => {
    const db = readDb();
    const { phoneNumber, accessId } = req.body;

    if (!isNonEmptyStr(phoneNumber) || !isNonEmptyStr(accessId)) {
      return res.status(400).json({ error: 'Phone number and Access ID are required.' });
    }

    const normPhone = normalizePhone(phoneNumber);
    const user = db.users.find(
      (u) => normalizePhone(u.phoneNumber) === normPhone &&
             u.accessId === accessId.trim().toUpperCase()
    );

    if (!user) {
      return res.status(401).json({ error: 'Incorrect phone number or Access ID. Please check and try again.' });
    }

    const token = createSession(db, 'client', user.id);
    writeDb(db);

    const bookings = db.bookings
      .filter((b) => b.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const activeBooking = bookings.find((b) => isActiveStatus(b.status));

    res.json({
      token,
      user: safeUser(user),
      activeBooking: activeBooking ? {
        ...expandBooking(db, activeBooking),
        queueMsg: queueMessage(db, activeBooking),
      } : null,
    });
  }
);

app.get('/api/client/status', requireAuth('client'), (req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.auth.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  const bookings = db.bookings
    .filter((b) => b.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((b) => ({ ...expandBooking(db, b), queueMsg: queueMessage(db, b) }));

  const activeBooking = bookings.find((b) => isActiveStatus(b.status));
  const counts = buildQueueCounts(db);

  res.json({
    user: safeUser(user),
    activeBooking: activeBooking || null,
    history: bookings.filter((b) => b.status === 'completed').slice(0, 10),
    queueCounts: counts,
  });
});

app.post('/api/client/bookings/:bookingId/payment',
  requireAuth('client'),
  rateLimit(5, 15 * 60 * 1000),
  uploadPayment.single('proof'),
  (req, res) => {
    const db = readDb();
    const booking = db.bookings.find((b) => b.id === req.params.bookingId);

    if (!booking || booking.userId !== req.auth.id) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (!['awaiting_payment', 'payment_rejected'].includes(booking.status)) {
      return res.status(400).json({ error: 'This booking is not awaiting a payment proof.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Please upload a payment screenshot.' });

    booking.paymentProofPath = normSlash(path.relative(ROOT, req.file.path));
    booking.status = 'payment_review';
    booking.paymentRejectReason = '';
    booking.paymentSubmittedAt = now();
    writeDb(db);

    res.json({ booking: expandBooking(db, booking) });
  }
);

// ─── Client feedback ─────────────────────────────────────────────────────────
app.post('/api/client/bookings/:bookingId/feedback',
  requireAuth('client'),
  rateLimit(3, 30 * 60 * 1000),
  (req, res) => {
    const db = readDb();
    const booking = db.bookings.find((b) => b.id === req.params.bookingId);

    if (!booking || booking.userId !== req.auth.id) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (booking.status !== 'completed') {
      return res.status(400).json({ error: 'Feedback can only be submitted after your session is complete.' });
    }
    if (db.feedback.find((f) => f.bookingId === booking.id)) {
      return res.status(409).json({ error: 'You have already submitted feedback for this session.' });
    }

    const rating = Number(req.body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const entry = {
      id:        newId('fbk'),
      bookingId: booking.id,
      userId:    booking.userId,
      gameId:    booking.gameId,
      rating,
      comment:   sanitize(req.body.comment || '').slice(0, 400),
      createdAt: now(),
    };

    db.feedback.push(entry);
    writeDb(db);

    res.status(201).json({ feedback: entry });
  }
);

// ─── Public: check if feedback exists for a booking ──────────────────────────
app.get('/api/client/bookings/:bookingId/feedback', requireAuth('client'), (req, res) => {
  const db = readDb();
  const booking = db.bookings.find((b) => b.id === req.params.bookingId);
  if (!booking || booking.userId !== req.auth.id) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const entry = db.feedback.find((f) => f.bookingId === booking.id);
  res.json({ submitted: !!entry, feedback: entry || null });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN AUTH
// ═════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/register',
  rateLimit(5, 30 * 60 * 1000),
  (req, res) => {
    const db = readDb();
    const { fullName, email, password } = req.body;

    if (!isNonEmptyStr(fullName) || !isNonEmptyStr(email) || !isNonEmptyStr(password)) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const normEmail = email.trim().toLowerCase();
    if (db.admins.some((a) => a.email === normEmail)) {
      return res.status(409).json({ error: 'An admin with this email already exists.' });
    }

    const admin = {
      id: newId('adm'),
      fullName: sanitize(fullName),
      email: normEmail,
      passwordHash: bcrypt.hashSync(password, 12),
      role: db.admins.length === 0 ? 'super_admin' : 'staff',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now(),
    };

    db.admins.push(admin);
    const token = createSession(db, 'admin', admin.id);
    writeDb(db);

    res.status(201).json({ token, admin: safeAdmin(admin) });
  }
);

app.post('/api/admin/login',
  rateLimit(8, 15 * 60 * 1000),
  (req, res) => {
    const db = readDb();
    const { email, password } = req.body;
    const ip = req.ip || '?';

    if (!isNonEmptyStr(email) || !isNonEmptyStr(password)) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const admin = db.admins.find((a) => a.email === email.trim().toLowerCase());

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (admin.lockedUntil && new Date(admin.lockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(admin.lockedUntil) - Date.now()) / 60000);
      return res.status(403).json({ error: `Account locked due to failed attempts. Try again in ${mins} minute(s).` });
    }

    if (!bcrypt.compareSync(password, admin.passwordHash)) {
      admin.failedAttempts = (admin.failedAttempts || 0) + 1;
      if (admin.failedAttempts >= 5) {
        admin.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        admin.failedAttempts = 0;
      }
      writeDb(db);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    admin.failedAttempts = 0;
    admin.lockedUntil = null;
    const token = createSession(db, 'admin', admin.id);
    writeDb(db);

    res.json({ token, admin: safeAdmin(admin) });
  }
);

app.get('/api/admin/me', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const admin = db.admins.find((a) => a.id === req.auth.id);
  if (!admin) return res.status(404).json({ error: 'Admin not found.' });
  res.json({ admin: safeAdmin(admin) });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/dashboard', requireAuth('admin'), (_req, res) => {
  const db = readDb();
  const approved = db.bookings.filter((b) => ['approved_waiting', 'playing', 'completed', 'missed_waiting'].includes(b.status));
  const pending = db.bookings.filter((b) => b.status === 'payment_review');
  const playing = db.bookings.filter((b) => b.status === 'playing');
  const completed = db.bookings.filter((b) => b.status === 'completed');

  res.json({
    stats: {
      pendingApprovals: pending.length,
      currentlyPlaying: playing.length,
      completedToday: completed.filter((b) => b.completedAt?.startsWith(new Date().toISOString().slice(0, 10))).length,
      totalApproved: approved.length,
      grossRevenue: approved.length * db.settings.ticketPriceBirr,
      totalUsers: db.users.length,
    },
    recentActivity: db.bookings
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8)
      .map((b) => ({ ...expandBooking(db, b), queueMsg: queueMessage(db, b) })),
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN PAYMENTS
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/payments', requireAuth('admin'), (_req, res) => {
  const db = readDb();
  const pending = db.bookings
    .filter((b) => b.status === 'payment_review')
    .sort((a, b) => new Date(a.paymentSubmittedAt || a.createdAt) - new Date(b.paymentSubmittedAt || b.createdAt))
    .map((b) => expandBooking(db, b));
  res.json({ pending, count: pending.length });
});

app.post('/api/admin/payments/:bookingId/approve', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const booking = db.bookings.find((b) => b.id === req.params.bookingId);

  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status !== 'payment_review') return res.status(400).json({ error: 'Not awaiting review.' });

  booking.status = 'approved_waiting';
  booking.approvedAt = now();
  booking.queueNumber = getNextQueueNum(db, booking.gameId);
  booking.paymentRejectReason = '';
  writeDb(db);

  res.json({ booking: { ...expandBooking(db, booking), queueMsg: queueMessage(db, booking) } });
});

app.post('/api/admin/payments/:bookingId/reject', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const booking = db.bookings.find((b) => b.id === req.params.bookingId);
  const reason = sanitize(req.body.reason || '');

  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status !== 'payment_review') return res.status(400).json({ error: 'Not awaiting review.' });

  booking.status = 'payment_rejected';
  booking.paymentRejectReason = reason || 'Payment screenshot not clear. Please upload again.';
  writeDb(db);

  res.json({ booking: expandBooking(db, booking) });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN QUEUE (per game)
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/queue/:gameId', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const { gameId } = req.params;
  const game = db.games.find((g) => g.id === gameId);
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const current = getCurrentPlaying(db, gameId);
  const waiting = getWaiting(db, gameId);
  const missed = db.bookings.filter((b) => b.status === 'missed_waiting' && b.gameId === gameId);

  res.json({
    game,
    currentPlaying: current ? { ...expandBooking(db, current), queueMsg: queueMessage(db, current) } : null,
    waiting: waiting.map((b) => ({ ...expandBooking(db, b), queueMsg: queueMessage(db, b) })),
    missedPool: missed.map((b) => expandBooking(db, b)),
  });
});

app.post('/api/admin/queue/:gameId/start-next', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const { gameId } = req.params;

  const current = getCurrentPlaying(db, gameId);
  if (current) return res.status(400).json({ error: 'A player is currently playing on this station. Complete them first.' });

  const next = pickNext(db, gameId);
  if (!next) return res.status(404).json({ error: 'No players waiting for this station.' });

  next.status = 'playing';
  next.startedAt = now();
  db.gameQueues[gameId].currentBookingId = next.id;
  db.gameQueues[gameId].cycleCounter++;
  writeDb(db);

  res.json({ currentPlaying: expandBooking(db, next) });
});

app.post('/api/admin/queue/:gameId/complete', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const { gameId } = req.params;
  const current = getCurrentPlaying(db, gameId);

  if (!current) return res.status(404).json({ error: 'No active player on this station.' });

  const score = req.body.score !== undefined && req.body.score !== '' ? Number(req.body.score) : null;

  current.status = 'completed';
  current.completedAt = now();
  if (score !== null && !Number.isNaN(score)) current.score = score;
  db.gameQueues[gameId].currentBookingId = null;
  db.gameQueues[gameId].lastCompletedBookingId = current.id;
  writeDb(db);

  res.json({ completed: expandBooking(db, current) });
});

app.post('/api/admin/queue/:gameId/missed', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const { gameId } = req.params;
  const current = getCurrentPlaying(db, gameId);

  if (!current) return res.status(404).json({ error: 'No active player on this station.' });

  current.status = 'missed_waiting';
  current.missedCount = (current.missedCount || 0) + 1;
  current.missedAt = now();
  db.gameQueues[gameId].currentBookingId = null;
  writeDb(db);

  res.json({ booking: expandBooking(db, current) });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN BOOKINGS
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/bookings', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const { status, gameId } = req.query;
  const list = db.bookings
    .filter((b) => (!status || b.status === status) && (!gameId || b.gameId === gameId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50)
    .map((b) => ({ ...expandBooking(db, b), queueMsg: queueMessage(db, b) }));
  res.json({ bookings: list });
});

app.post('/api/admin/bookings/:bookingId/score', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const booking = db.bookings.find((b) => b.id === req.params.bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (!['playing', 'completed'].includes(booking.status)) {
    return res.status(400).json({ error: 'Can only set score for active or completed sessions.' });
  }

  const score = Number(req.body.score);
  if (Number.isNaN(score)) return res.status(400).json({ error: 'Score must be a number.' });

  booking.score = score;
  writeDb(db);
  res.json({ booking: expandBooking(db, booking) });
});

app.post('/api/admin/bookings/:bookingId/media',
  requireAuth('admin'),
  uploadMedia.single('media'),
  (req, res) => {
    const db = readDb();
    const booking = db.bookings.find((b) => b.id === req.params.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    booking.gameplayMedia = booking.gameplayMedia || [];
    booking.gameplayMedia.push(normSlash(path.relative(ROOT, req.file.path)));
    writeDb(db);
    res.json({ booking: expandBooking(db, booking) });
  }
);

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN GAMES (update only — 2 games are fixed)
// ═════════════════════════════════════════════════════════════════════════════

app.put('/api/admin/games/:gameId',
  requireAuth('admin'),
  uploadGameMedia.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]),
  (req, res) => {
    const db = readDb();
    const game = db.games.find((g) => g.id === req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found.' });

    if (req.body.name)        game.name        = sanitize(req.body.name);
    if (req.body.description) game.description = sanitize(req.body.description);
    if (req.files?.image?.[0]) game.imagePath = normSlash(path.relative(ROOT, req.files.image[0].path));
    if (req.files?.video?.[0]) game.videoPath = normSlash(path.relative(ROOT, req.files.video[0].path));
    writeDb(db);
    res.json({ game });
  }
);

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN FINANCE
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/finance', requireAuth('admin'), (_req, res) => {
  const db = readDb();
  const price = db.settings.ticketPriceBirr;
  const approved = db.bookings.filter((b) => ['approved_waiting', 'playing', 'completed', 'missed_waiting'].includes(b.status));
  const completed = db.bookings.filter((b) => b.status === 'completed');
  const pendingReview = db.bookings.filter((b) => b.status === 'payment_review');
  const rejected = db.bookings.filter((b) => b.status === 'payment_rejected');

  const byGame = db.games.map((g) => {
    const n = approved.filter((b) => b.gameId === g.id).length;
    return { gameName: g.name, stationNumber: g.stationNumber, bookings: n, revenue: n * price };
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCompleted = completed.filter((b) => b.completedAt?.startsWith(todayStr));

  res.json({
    finance: {
      ticketPriceBirr: price,
      totalApproved: approved.length,
      totalCompleted: completed.length,
      pendingReview: pendingReview.length,
      rejectedPayments: rejected.length,
      grossRevenue: approved.length * price,
      todayRevenue: todayCompleted.length * price,
      todayCompleted: todayCompleted.length,
      byGame,
    },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN FEEDBACK
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/feedback', requireAuth('admin'), (_req, res) => {
  const db = readDb();
  const list = (db.feedback || [])
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((f) => {
      const user  = db.users.find((u) => u.id === f.userId);
      const game  = db.games.find((g) => g.id === f.gameId);
      return {
        ...f,
        user:  user  ? { fullName: user.fullName, phoneNumber: user.phoneNumber } : null,
        game:  game  ? { name: game.name, stationNumber: game.stationNumber }     : null,
      };
    });

  const avgRating = list.length
    ? (list.reduce((s, f) => s + f.rating, 0) / list.length).toFixed(1)
    : null;

  res.json({ feedback: list, count: list.length, avgRating });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN SETTINGS
// ═════════════════════════════════════════════════════════════════════════════

app.put('/api/admin/settings', requireAuth('admin'), (req, res) => {
  const db = readDb();
  const s = db.settings;
  if (req.body.telebirr    !== undefined) s.paymentMethods.telebirr    = sanitize(req.body.telebirr);
  if (req.body.cbe         !== undefined) s.paymentMethods.cbe         = sanitize(req.body.cbe);
  if (req.body.holderName  !== undefined) s.paymentMethods.holderName  = sanitize(req.body.holderName);
  if (req.body.missedInsertEvery && !Number.isNaN(Number(req.body.missedInsertEvery))) {
    s.missedInsertEvery = Math.max(1, Math.min(20, Number(req.body.missedInsertEvery)));
  }
  writeDb(db);
  res.json({ settings: s });
});

// ─── SPA catch-all ────────────────────────────────────────────────────────────
// ─── HTML entry points — served directly from project root ───────────────────
app.get('/',             (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/admin',        (_req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
app.get('/admin.html',   (_req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
app.get('/display',      (_req, res) => res.sendFile(path.join(ROOT, 'display.html')));
app.get('/display.html', (_req, res) => res.sendFile(path.join(ROOT, 'display.html')));

// ─── Catch-all → client portal ───────────────────────────────────────────────
app.get(/.*/, (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

// ─── Multer error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large.' });
  if (err?.message) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  SaNex Realities Queue System\n  Running at http://localhost:${PORT}\n`);
});

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function initStorage() {
  [DATA_DIR, UPLOADS_DIR, ...['payments', 'gameplay', 'games'].map((f) => path.join(UPLOADS_DIR, f))].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8');
  } else {
    const db = readDb();
    let dirty = false;
    if (!db.gameQueues) {
      db.gameQueues = DEFAULT_DB.gameQueues;
      dirty = true;
    }
    // Migrate: if holderName not yet set, strip it out of telebirr/cbe
    if (!db.feedback) { db.feedback = []; dirty = true; }
    if (!db.settings.paymentMethods.holderName) {
      db.settings.paymentMethods.holderName = 'SaNex Realities';
      db.settings.paymentMethods.telebirr = db.settings.paymentMethods.telebirr.replace(/\s*\(.*?\)\s*$/, '').trim();
      db.settings.paymentMethods.cbe      = db.settings.paymentMethods.cbe.replace(/\s*\(.*?\)\s*$/, '').trim();
      dirty = true;
    }
    for (const g of db.games) {
      if (!db.gameQueues[g.id]) {
        db.gameQueues[g.id] = { currentBookingId: null, lastCompletedBookingId: null, cycleCounter: 0 };
        dirty = true;
      }
    }
    if (dirty) {
      _dbCache = db;
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
    }
  }
}

// ─── In-memory DB cache ───────────────────────────────────────────────────────
// Reads hit RAM only. Writes update RAM immediately then flush to disk async
// with a short debounce so burst writes (e.g. queue updates) collapse into one.

function readDb() {
  if (!_dbCache) {
    _dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  }
  return _dbCache;
}

function writeDb(db) {
  _dbCache = db;
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => {
    const snapshot = JSON.stringify(_dbCache, null, 2);
    fs.writeFile(DB_FILE, snapshot, 'utf-8', (err) => {
      if (err) console.error('[db] flush error:', err.message);
    });
  }, 150);
}

// Periodic safety flush every 30 s to ensure data is persisted
setInterval(() => {
  if (!_dbCache) return;
  const snapshot = JSON.stringify(_dbCache, null, 2);
  fs.writeFile(DB_FILE, snapshot, 'utf-8', (err) => {
    if (err) console.error('[db] periodic flush error:', err.message);
  });
}, 30_000);

// Flush synchronously on clean shutdown so no data is lost
function flushSync() {
  if (_dbCache) {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(_dbCache, null, 2), 'utf-8'); } catch (_) {}
  }
}
process.on('SIGINT',  () => { flushSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSync(); process.exit(0); });

function generateAccessId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function createSession(db, role, entityId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions = db.sessions.filter((s) => !(s.role === role && s.entityId === entityId));
  db.sessions.push({ token, role, entityId, createdAt: now() });
  return token;
}

function requireAuth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
    const token = header.slice(7).trim();
    const db = readDb();
    const session = db.sessions.find((s) => s.token === token && s.role === role);
    if (!session) return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    req.auth = { id: session.entityId, role };
    next();
  };
}

function sanitize(str) {
  return String(str || '').trim().slice(0, 500);
}

function isNonEmptyStr(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function normalizePhone(phone) {
  return String(phone).replace(/[\s\-().+]/g, '');
}

function normSlash(p) {
  return p.replace(/\\/g, '/');
}

function now() {
  return new Date().toISOString();
}

function isActiveStatus(status) {
  return ['awaiting_payment', 'payment_review', 'payment_rejected', 'approved_waiting', 'playing', 'missed_waiting'].includes(status);
}

function safeUser(user) {
  return { id: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber, telegram: user.telegram, createdAt: user.createdAt };
}

function safeAdmin(admin) {
  return { id: admin.id, fullName: admin.fullName, email: admin.email, role: admin.role, createdAt: admin.createdAt };
}

function getCurrentPlaying(db, gameId) {
  const q = db.gameQueues[gameId];
  if (!q?.currentBookingId) return null;
  const b = db.bookings.find((x) => x.id === q.currentBookingId && x.status === 'playing');
  if (!b) { q.currentBookingId = null; return null; }
  return b;
}

function getWaiting(db, gameId) {
  return db.bookings
    .filter((b) => b.status === 'approved_waiting' && b.gameId === gameId)
    .sort((a, b) => (a.queueNumber || 0) - (b.queueNumber || 0));
}

function getNextQueueNum(db, gameId) {
  const max = db.bookings
    .filter((b) => b.gameId === gameId && b.queueNumber !== null)
    .reduce((acc, b) => Math.max(acc, b.queueNumber || 0), 0);
  return max + 1;
}

function pickNext(db, gameId) {
  const regular = getWaiting(db, gameId);
  const missed = db.bookings
    .filter((b) => b.status === 'missed_waiting' && b.gameId === gameId)
    .sort((a, b) => new Date(a.missedAt || a.createdAt) - new Date(b.missedAt || b.createdAt));

  if (!regular.length && !missed.length) return null;

  const every = db.settings.missedInsertEvery || 4;
  const cycle = db.gameQueues[gameId]?.cycleCounter || 0;
  if (missed.length && cycle > 0 && cycle % every === 0) return missed[0];
  if (regular.length) return regular[0];
  return missed[0];
}

function expandBooking(db, booking) {
  if (!booking) return null;
  const user = db.users.find((u) => u.id === booking.userId);
  const game = db.games.find((g) => g.id === booking.gameId);
  return {
    ...booking,
    user: user ? safeUser(user) : null,
    game: game ? { id: game.id, name: game.name, stationNumber: game.stationNumber, imagePath: game.imagePath } : null,
  };
}

function buildQueueCounts(db) {
  const result = {};
  for (const game of db.games) {
    const waiting = getWaiting(db, game.id).length;
    const missed = db.bookings.filter((b) => b.status === 'missed_waiting' && b.gameId === game.id).length;
    const current = getCurrentPlaying(db, game.id);
    result[game.id] = {
      gameName: game.name,
      stationNumber: game.stationNumber,
      waiting,
      missedPool: missed,
      isPlaying: !!current,
      currentPlayerName: current ? db.users.find((u) => u.id === current.userId)?.fullName || null : null,
    };
  }
  return result;
}

function queueMessage(db, booking) {
  if (booking.status === 'awaiting_payment') {
    return { type: 'info', text: 'Complete payment to join the queue.' };
  }
  if (booking.status === 'payment_review') {
    return { type: 'info', text: 'Your payment is under review. Hang tight!' };
  }
  if (booking.status === 'payment_rejected') {
    return { type: 'error', text: `Payment rejected: ${booking.paymentRejectReason}. Please upload a clear screenshot.` };
  }
  if (booking.status === 'playing') {
    return { type: 'playing', text: 'It\'s your turn! Enjoy your VR experience.' };
  }
  if (booking.status === 'completed') {
    return { type: 'done', text: 'Session complete. Check your score below!' };
  }
  if (booking.status === 'missed_waiting') {
    return { type: 'warning', text: 'You missed your call. Stay close — you\'ll be reinserted soon.' };
  }

  const waiting = getWaiting(db, booking.gameId);
  const ahead = waiting.filter((b) => (b.queueNumber || 0) < (booking.queueNumber || 0)).length;

  if (ahead === 0) return { type: 'urgent', text: 'Please proceed to the station NOW.' };
  if (ahead === 1) return { type: 'urgent', text: 'Come near the station — you\'re next!' };
  if (ahead === 2) return { type: 'ready', text: 'Get ready. Only 2 people ahead of you.' };
  if (ahead === 3) return { type: 'ready', text: 'Almost there — 3 people ahead.' };
  return { type: 'waiting', text: `You are #${booking.queueNumber} — ${ahead} people ahead of you.` };
}
