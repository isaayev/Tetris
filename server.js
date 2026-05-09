const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
require("dotenv").config();

const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRailway ? { rejectUnauthorized: false } : undefined,
});
const app = express();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function isUniqueViolation(error) {
  return error && error.code === "23505";
}

function uniqueFieldFromDetail(detail) {
  if (!detail) return "field";
  const match = detail.match(/\(([^)]+)\)=/);
  if (!match) return "field";
  const rawField = match[1];
  if (rawField === "username_key" || rawField === "username") return "username";
  if (rawField === "email") return "email";
  return rawField;
}

async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      username_key TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      best_score INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_best_score_username
      ON users (best_score DESC, username ASC)
  `);
}

let dbInitError = null;
const dbReady = ensureDatabaseSchema().catch((error) => {
  dbInitError = error;
  console.error("Database initialization failed:", error.message);
});

async function requireDatabase(res) {
  await dbReady;
  if (dbInitError) {
    res.status(503).json({ error: "Database is unavailable. Check DATABASE_URL." });
    return false;
  }
  return true;
}

async function getUserById(userId) {
  const result = await pool.query(
    `SELECT id, email, username, username_key, best_score, is_admin, is_blocked
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function requireAdmin(req, res) {
  if (!(await requireDatabase(res))) return null;
  const user = await getUserById(req.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return null;
  }
  if (user.is_blocked) {
    res.status(403).json({ error: "Account is blocked" });
    return null;
  }
  if (!user.is_admin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return user;
}

function mapPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    bestScore: row.best_score,
    isAdmin: row.is_admin,
    isBlocked: row.is_blocked,
  };
}

app.post("/api/register", async (req, res) => {
  try {
    if (!(await requireDatabase(res))) return;
    const email = normalizeEmail(req.body.email);
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (username.length < 2 || username.length > 32) {
      return res.status(400).json({ error: "Username must be 2–32 characters" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const usernameKey = username.toLowerCase();
    const passwordHash = await bcrypt.hash(password, 10);
    const usersCountResult = await pool.query(`SELECT COUNT(*)::int AS count FROM users`);
    const isFirstUser = Number(usersCountResult.rows[0]?.count || 0) === 0;

    const insertResult = await pool.query(
      `INSERT INTO users (email, username, username_key, password_hash, is_admin)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, username, best_score, is_admin, is_blocked`,
      [email, username, usernameKey, passwordHash, isFirstUser],
    );

    const row = insertResult.rows[0];
    const user = mapPublicUser(row);

    const token = signToken(user.id);
    return res.status(201).json({ token, user });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const field = uniqueFieldFromDetail(e.detail);
      return res.status(409).json({ error: `Already taken: ${field}` });
    }
    console.error(e);
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    if (!(await requireDatabase(res))) return;
    const login = String(req.body.login || "").trim();
    const password = String(req.body.password || "");

    if (!login || !password) {
      return res.status(400).json({ error: "Login and password are required" });
    }

    const userResult = await pool.query(
      `SELECT id, email, username, password_hash, best_score, is_admin, is_blocked
       FROM users
       WHERE username_key = $1 OR email = $2
       LIMIT 1`,
      [login.toLowerCase(), login.includes("@") ? normalizeEmail(login) : ""],
    );
    const user = userResult.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid login or password" });
    }
    if (user.is_blocked) {
      return res.status(403).json({ error: "Your account is blocked by admin" });
    }

    const token = signToken(user.id);
    return res.json({
      token,
      user: mapPublicUser(user),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    if (!(await requireDatabase(res))) return;
    const userResult = await pool.query(
      `SELECT id, email, username, best_score, is_admin, is_blocked
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.userId],
    );
    const user = userResult.rows[0] ? mapPublicUser(userResult.rows[0]) : null;

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.isBlocked) return res.status(403).json({ error: "Account is blocked" });
    return res.json({ user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

app.post("/api/score", authMiddleware, async (req, res) => {
  try {
    if (!(await requireDatabase(res))) return;
    const score = Number(req.body.score);
    if (!Number.isFinite(score) || score < 0 || score > 1_000_000_000) {
      return res.status(400).json({ error: "Invalid score" });
    }

    const userResult = await pool.query(
      `SELECT id, best_score, is_blocked
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.userId],
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.is_blocked) return res.status(403).json({ error: "Account is blocked" });

    const bestScore = Math.max(Number(user.best_score || 0), Math.floor(score));
    await pool.query(`UPDATE users SET best_score = $1 WHERE id = $2`, [bestScore, user.id]);

    return res.json({ bestScore });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to save score" });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    if (!(await requireDatabase(res))) return;
    const result = await pool.query(
      `SELECT username, best_score
       FROM users
       WHERE is_blocked = FALSE
       ORDER BY best_score DESC, username ASC`,
    );
    const rows = result.rows.map((row) => ({
      username: row.username,
      bestScore: row.best_score,
    }));
    return res.json({ leaderboard: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

app.post("/api/admin/grant", authMiddleware, async (req, res) => {
  try {
    const me = await requireAdmin(req, res);
    if (!me) return;

    const targetLogin = String(req.body.login || "").trim();
    if (!targetLogin) {
      return res.status(400).json({ error: "Target login is required" });
    }

    const result = await pool.query(
      `UPDATE users
       SET is_admin = TRUE
       WHERE username_key = $1 OR email = $2
       RETURNING id, email, username, best_score, is_admin, is_blocked`,
      [targetLogin.toLowerCase(), targetLogin.includes("@") ? normalizeEmail(targetLogin) : ""],
    );
    const target = result.rows[0];
    if (!target) return res.status(404).json({ error: "Target user not found" });
    return res.json({ user: mapPublicUser(target) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to grant admin access" });
  }
});

app.get("/api/admin/users", authMiddleware, async (req, res) => {
  try {
    const me = await requireAdmin(req, res);
    if (!me) return;
    const result = await pool.query(
      `SELECT id, email, username, best_score, is_admin, is_blocked, created_at
       FROM users
       ORDER BY created_at DESC`,
    );
    return res.json({ users: result.rows.map(mapPublicUser) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list users" });
  }
});

app.patch("/api/admin/users/:id", authMiddleware, async (req, res) => {
  try {
    const me = await requireAdmin(req, res);
    if (!me) return;

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: "Invalid user id" });
    }
    if (targetId === Number(me.id)) {
      return res.status(400).json({ error: "You cannot edit yourself here" });
    }

    const username = req.body.username === undefined ? undefined : normalizeUsername(req.body.username);
    const email = req.body.email === undefined ? undefined : normalizeEmail(req.body.email);
    const isBlocked = req.body.isBlocked;
    const isAdmin = req.body.isAdmin;

    if (username !== undefined && (username.length < 2 || username.length > 32)) {
      return res.status(400).json({ error: "Username must be 2–32 characters" });
    }
    if (email !== undefined && (!email || !email.includes("@"))) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (isBlocked !== undefined && typeof isBlocked !== "boolean") {
      return res.status(400).json({ error: "isBlocked must be boolean" });
    }
    if (isAdmin !== undefined && typeof isAdmin !== "boolean") {
      return res.status(400).json({ error: "isAdmin must be boolean" });
    }

    const existing = await getUserById(targetId);
    if (!existing) return res.status(404).json({ error: "User not found" });

    const nextUsername = username === undefined ? existing.username : username;
    const nextEmail = email === undefined ? existing.email : email;
    const nextBlocked = isBlocked === undefined ? existing.is_blocked : isBlocked;
    const nextAdmin = isAdmin === undefined ? existing.is_admin : isAdmin;

    const updated = await pool.query(
      `UPDATE users
       SET username = $1,
           username_key = $2,
           email = $3,
           is_blocked = $4,
           is_admin = $5
       WHERE id = $6
       RETURNING id, email, username, best_score, is_admin, is_blocked`,
      [nextUsername, nextUsername.toLowerCase(), nextEmail, nextBlocked, nextAdmin, targetId],
    );
    return res.json({ user: mapPublicUser(updated.rows[0]) });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const field = uniqueFieldFromDetail(e.detail);
      return res.status(409).json({ error: `Already taken: ${field}` });
    }
    console.error(e);
    return res.status(500).json({ error: "Failed to update user" });
  }
});

app.delete("/api/admin/users/:id", authMiddleware, async (req, res) => {
  try {
    const me = await requireAdmin(req, res);
    if (!me) return;

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: "Invalid user id" });
    }
    if (targetId === Number(me.id)) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    const deleted = await pool.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [targetId]);
    if (!deleted.rows[0]) return res.status(404).json({ error: "User not found" });
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete user" });
  }
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server ${PORT} portunda aktivdir`);
});
