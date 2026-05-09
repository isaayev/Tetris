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
  return match ? match[1] : "field";
}

app.post("/api/register", async (req, res) => {
  try {
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

    const insertResult = await pool.query(
      `INSERT INTO users (email, username, username_key, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, username, best_score`,
      [email, username, usernameKey, passwordHash],
    );

    const row = insertResult.rows[0];
    const user = {
      id: row.id,
      email: row.email,
      username: row.username,
      bestScore: row.best_score,
    };

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
    const login = String(req.body.login || "").trim();
    const password = String(req.body.password || "");

    if (!login || !password) {
      return res.status(400).json({ error: "Login and password are required" });
    }

    const userResult = await pool.query(
      `SELECT id, email, username, password_hash, best_score
       FROM users
       WHERE username_key = $1 OR email = $2
       LIMIT 1`,
      [login.toLowerCase(), login.includes("@") ? normalizeEmail(login) : ""],
    );
    const user = userResult.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid login or password" });
    }

    const token = signToken(user.id);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        bestScore: user.best_score,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT id, email, username, best_score
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.userId],
    );
    const row = userResult.rows[0];
    const user = row
      ? { id: row.id, email: row.email, username: row.username, bestScore: row.best_score }
      : null;

    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({ user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

app.post("/api/score", authMiddleware, async (req, res) => {
  try {
    const score = Number(req.body.score);
    if (!Number.isFinite(score) || score < 0 || score > 1_000_000_000) {
      return res.status(400).json({ error: "Invalid score" });
    }

    const userResult = await pool.query(
      `SELECT id, best_score
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.userId],
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

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
    const result = await pool.query(
      `SELECT username, best_score
       FROM users
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

app.use(express.static(path.join(__dirname)));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server ${PORT} portunda aktivdir`);
});
