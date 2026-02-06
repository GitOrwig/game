const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

// ── User operations ─────────────────────────────────────────────────────────

function createUser(username, password) {
  const users = loadJSON(USERS_FILE);
  const key = username.toLowerCase();
  if (users[key]) return { ok: false, error: 'Username already taken.' };
  if (username.length < 2 || username.length > 16) return { ok: false, error: 'Username must be 2-16 characters.' };
  if (password.length < 3) return { ok: false, error: 'Password must be at least 3 characters.' };

  const { salt, hash } = hashPassword(password);
  users[key] = {
    username,       // preserve original casing
    salt,
    hash,
    createdAt: Date.now(),
  };
  saveJSON(USERS_FILE, users);

  // Init stats
  const stats = loadJSON(STATS_FILE);
  stats[key] = newStats(username);
  saveJSON(STATS_FILE, stats);

  return { ok: true, username };
}

function loginUser(username, password) {
  const users = loadJSON(USERS_FILE);
  const key = username.toLowerCase();
  const user = users[key];
  if (!user) return { ok: false, error: 'User not found.' };

  const { hash } = hashPassword(password, user.salt);
  if (hash !== user.hash) return { ok: false, error: 'Wrong password.' };

  return { ok: true, username: user.username };
}

// ── Stats operations ────────────────────────────────────────────────────────

function newStats(username) {
  return {
    username,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    totalPoints: 0,
    bellsCaught: 0,       // times you rang the bell on opponent
    wordsDescribed: 0,    // successful descriptions
    umsGotten: 0,         // times bell was rung on you
    currentStreak: 0,
    bestStreak: 0,
  };
}

function getStats(username) {
  const stats = loadJSON(STATS_FILE);
  const key = username.toLowerCase();
  return stats[key] || newStats(username);
}

function recordGame(player1Name, player2Name, scores, turnStats) {
  const stats = loadJSON(STATS_FILE);
  const k1 = player1Name.toLowerCase();
  const k2 = player2Name.toLowerCase();

  if (!stats[k1]) stats[k1] = newStats(player1Name);
  if (!stats[k2]) stats[k2] = newStats(player2Name);

  const s1 = stats[k1];
  const s2 = stats[k2];

  const score1 = scores.p1 || 0;
  const score2 = scores.p2 || 0;

  s1.gamesPlayed++;
  s2.gamesPlayed++;
  s1.totalPoints += score1;
  s2.totalPoints += score2;

  // Turn-level stats
  if (turnStats) {
    s1.bellsCaught += turnStats.p1.bellsCaught || 0;
    s2.bellsCaught += turnStats.p2.bellsCaught || 0;
    s1.wordsDescribed += turnStats.p1.wordsDescribed || 0;
    s2.wordsDescribed += turnStats.p2.wordsDescribed || 0;
    s1.umsGotten += turnStats.p1.umsGotten || 0;
    s2.umsGotten += turnStats.p2.umsGotten || 0;
  }

  if (score1 > score2) {
    s1.wins++; s2.losses++;
    s1.currentStreak++; s2.currentStreak = 0;
  } else if (score2 > score1) {
    s2.wins++; s1.losses++;
    s2.currentStreak++; s1.currentStreak = 0;
  } else {
    s1.ties++; s2.ties++;
    // ties don't break streaks
  }

  s1.bestStreak = Math.max(s1.bestStreak, s1.currentStreak);
  s2.bestStreak = Math.max(s2.bestStreak, s2.currentStreak);

  saveJSON(STATS_FILE, stats);
  return { p1: s1, p2: s2 };
}

function getLeaderboard() {
  const stats = loadJSON(STATS_FILE);
  return Object.values(stats)
    .filter(s => s.gamesPlayed > 0)
    .sort((a, b) => b.wins - a.wins || b.totalPoints - a.totalPoints)
    .slice(0, 20);
}

module.exports = {
  createUser,
  loginUser,
  getStats,
  recordGame,
  getLeaderboard,
};
