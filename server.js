const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const prisma = new PrismaClient();
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

    const user = await prisma.user.create({
      data: { email, username, usernameKey, passwordHash },
      select: { id: true, email: true, username: true, bestScore: true },
    });

    const token = signToken(user.id);
    return res.status(201).json({ token, user });
  } catch (e) {
    if (e.code === "P2002") {
      const field = Array.isArray(e.meta?.target) ? e.meta.target.join(", ") : "field";
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

    const or = [{ usernameKey: login.toLowerCase() }];
    if (login.includes("@")) {
      or.push({ email: normalizeEmail(login) });
    }

    const user = await prisma.user.findFirst({ where: { OR: or } });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid login or password" });
    }

    const token = signToken(user.id);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        bestScore: user.bestScore,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, username: true, bestScore: true },
    });
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

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const bestScore = Math.max(user.bestScore, Math.floor(score));
    await prisma.user.update({
      where: { id: user.id },
      data: { bestScore },
    });

    return res.json({ bestScore });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to save score" });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    const rows = await prisma.user.findMany({
      select: { username: true, bestScore: true },
      orderBy: [{ bestScore: "desc" }, { username: "asc" }],
    });
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
