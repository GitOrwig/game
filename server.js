const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const store = require('./store');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Word bank: words/phrases players must describe ──────────────────────────
const WORDS = [
  "peanut butter", "roller coaster", "solar eclipse", "bubble bath",
  "alarm clock", "treasure map", "hot dog", "moonwalk", "pillow fight",
  "ice cream truck", "bunk bed", "magic carpet", "snow globe", "rubber duck",
  "cannonball", "fingerprint", "haunted house", "jigsaw puzzle", "lava lamp",
  "paper airplane", "quicksand", "road trip", "scarecrow", "time machine",
  "umbrella", "volcano", "waterfall", "xylophone", "yo-yo", "zipper",
  "astronaut", "boomerang", "catapult", "disco ball", "earthquake",
  "fireworks", "gingerbread", "hammock", "igloo", "jackpot",
  "kaleidoscope", "lightning bolt", "marshmallow", "ninja", "octopus",
  "parachute", "quarterback", "rainbow", "submarine", "trampoline",
  "unicycle", "vampire", "windmill", "karate chop", "belly flop",
  "cloud nine", "double dutch", "french fries", "goosebumps", "high five",
  "jump rope", "knee slide", "limbo", "moustache", "night owl",
  "overtime", "photobomb", "quarterback sneak", "rewind", "stage dive",
  "thumbs up", "upside down", "vending machine", "wheelbarrow", "brain freeze",
  "chicken nugget", "duct tape", "elbow grease", "fist bump", "grocery store",
  "headband", "ice skating", "juggling", "karaoke", "lemonade stand",
  "microphone", "napkin", "obstacle course", "popcorn", "quilt",
  "remote control", "sleeping bag", "toothbrush", "underground", "volleyball",
  "waffle iron", "crossword", "yawn", "zeppelin", "back flip",
  "campfire", "dominoes", "escalator", "fortune cookie", "garage sale",
  "hiccup", "invitation", "jukebox", "ketchup", "laundromat",
  "milkshake", "newspaper", "orchestra", "pancake", "question mark",
  "rocking chair", "sunburn", "typewriter", "unicorn", "vacuum cleaner",
  "whirlpool", "boxing ring", "yoga mat", "zip line"
];

// ── Challenge rules — only real, enforceable ones ───────────────────────────
const CHALLENGE_RULES = [
  { id: "no-s-words", text: "No words starting with 'S'" },
  { id: "no-yes-no", text: "Can't say 'Yes' or 'No'" },
  { id: "no-the-a", text: "Can't say 'the' or 'a'" },
  { id: "no-names", text: "Can't use proper nouns or names" },
  { id: "no-rhyming", text: "Can't use words that rhyme with the target word" },
  { id: "backwards-clue", text: "First clue must describe the opposite" },
  { id: "no-body-parts", text: "Can't reference any body parts" },
  { id: "no-colors", text: "Can't say any colors" },
  { id: "no-numbers", text: "Can't use any numbers" },
  { id: "no-e-words", text: "No words starting with 'E'" },
  { id: "no-like", text: "Can't say 'like' or 'thing'" },
  { id: "no-negatives", text: "Can't use 'not', 'no', 'never', or 'don't'" },
  { id: "no-size-words", text: "Can't say 'big', 'small', 'large', or 'tiny'" },
  { id: "no-it-this", text: "Can't say 'it', 'this', or 'that'" },
  { id: "three-words-max", text: "Each clue must be 3 words or fewer" },
];

// ── Game state per room ─────────────────────────────────────────────────────
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createRoom(code) {
  return {
    code,
    players: [],          // [{id, name, socketId, username}]
    scores: {},           // {playerId: score}
    turnStats: {          // per-game stats per player
      p1: { bellsCaught: 0, wordsDescribed: 0, umsGotten: 0 },
      p2: { bellsCaught: 0, wordsDescribed: 0, umsGotten: 0 },
    },
    round: 0,
    turnIndex: 0,
    currentWord: null,
    deck: shuffleArray(WORDS),
    deckIndex: 0,
    activeRules: [],
    availableRules: shuffleArray(CHALLENGE_RULES),
    ruleIndex: 0,
    phase: 'lobby',
    turnTimeLeft: 60,
    timer: null,
    totalRounds: 10,
  };
}

function drawCard(room) {
  if (room.deckIndex >= room.deck.length) {
    room.deck = shuffleArray(WORDS);
    room.deckIndex = 0;
  }
  const word = room.deck[room.deckIndex];
  room.deckIndex++;
  return word;
}

function addChallengeRule(room) {
  if (room.ruleIndex < room.availableRules.length) {
    const rule = room.availableRules[room.ruleIndex];
    room.ruleIndex++;
    room.activeRules.push(rule);
    return rule;
  }
  return null;
}

function getDescriber(room) {
  return room.players[room.turnIndex];
}

function getGuesser(room) {
  return room.players[(room.turnIndex + 1) % room.players.length];
}

function startTurn(room) {
  room.phase = 'describing';
  room.currentWord = drawCard(room);
  room.turnTimeLeft = 60;

  const describer = getDescriber(room);
  const guesser = getGuesser(room);

  io.to(describer.socketId).emit('turn-start', {
    word: room.currentWord,
    role: 'describer',
    round: room.round,
    activeRules: room.activeRules,
    describer: describer.name,
    guesser: guesser.name,
    timeLeft: room.turnTimeLeft,
  });

  io.to(guesser.socketId).emit('turn-start', {
    word: null,
    role: 'guesser',
    round: room.round,
    activeRules: room.activeRules,
    describer: describer.name,
    guesser: guesser.name,
    timeLeft: room.turnTimeLeft,
  });

  clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.turnTimeLeft--;
    io.to(room.code).emit('timer-tick', { timeLeft: room.turnTimeLeft });
    if (room.turnTimeLeft <= 0) {
      clearInterval(room.timer);
      endTurn(room, 'timeout');
    }
  }, 1000);
}

function endTurn(room, reason) {
  clearInterval(room.timer);
  room.phase = 'roundEnd';

  const describer = getDescriber(room);
  const guesser = getGuesser(room);

  let message = '';
  if (reason === 'bell') {
    room.scores[guesser.id]++;
    room.turnStats[guesser.id].bellsCaught++;
    room.turnStats[describer.id].umsGotten++;
    message = `\u{1F514} ${guesser.name} rang the bell! They caught an "um"! +1 point for ${guesser.name}`;
  } else if (reason === 'guessed') {
    room.scores[describer.id]++;
    room.turnStats[describer.id].wordsDescribed++;
    message = `\u2705 ${guesser.name} guessed it! The word was "${room.currentWord}". +1 point for ${describer.name}`;
  } else if (reason === 'timeout') {
    message = `\u23F0 Time's up! The word was "${room.currentWord}". No points awarded.`;
  } else if (reason === 'skip') {
    message = `\u23ED\uFE0F Card skipped! The word was "${room.currentWord}".`;
  }

  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.round++;

  let newRule = null;
  if (room.round > 0 && room.round % 2 === 0) {
    newRule = addChallengeRule(room);
  }

  const gameOver = room.round >= room.totalRounds;

  // Record stats when game ends
  let finalStats = null;
  if (gameOver) {
    room.phase = 'gameOver';
    const p1 = room.players.find(p => p.id === 'p1');
    const p2 = room.players.find(p => p.id === 'p2');
    if (p1 && p2 && p1.username && p2.username) {
      const updatedStats = store.recordGame(p1.username, p2.username, room.scores, room.turnStats);
      finalStats = {
        p1: updatedStats.p1,
        p2: updatedStats.p2,
      };
    }
  }

  io.to(room.code).emit('turn-end', {
    reason,
    message,
    word: room.currentWord,
    scores: room.scores,
    round: room.round,
    totalRounds: room.totalRounds,
    newRule,
    activeRules: room.activeRules,
    gameOver,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    turnStats: gameOver ? room.turnStats : undefined,
    finalStats: finalStats || undefined,
  });
}

// ── Socket.io event handling ────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = null;
  let loggedInUser = null;    // username if authenticated

  // ── Auth ────────────────────────────────────────────────────────────────
  socket.on('signup', ({ username, password }) => {
    const result = store.createUser(username, password);
    if (result.ok) {
      loggedInUser = result.username;
      socket.emit('auth-ok', { username: result.username, stats: store.getStats(result.username) });
    } else {
      socket.emit('auth-error', { message: result.error });
    }
  });

  socket.on('login', ({ username, password }) => {
    const result = store.loginUser(username, password);
    if (result.ok) {
      loggedInUser = result.username;
      socket.emit('auth-ok', { username: result.username, stats: store.getStats(result.username) });
    } else {
      socket.emit('auth-error', { message: result.error });
    }
  });

  socket.on('get-stats', ({ username }) => {
    socket.emit('stats-data', { stats: store.getStats(username || loggedInUser) });
  });

  socket.on('get-leaderboard', () => {
    socket.emit('leaderboard-data', { leaderboard: store.getLeaderboard() });
  });

  // ── Room management ─────────────────────────────────────────────────────
  socket.on('create-room', () => {
    if (!loggedInUser) { socket.emit('error-msg', { message: 'Please log in first.' }); return; }

    let code;
    do { code = generateRoomCode(); } while (rooms.has(code));

    const room = createRoom(code);
    playerId = 'p1';
    room.players.push({ id: playerId, name: loggedInUser, socketId: socket.id, username: loggedInUser });
    room.scores[playerId] = 0;
    rooms.set(code, room);
    currentRoom = code;
    socket.join(code);

    socket.emit('room-created', { code, playerId, playerName: loggedInUser });
  });

  socket.on('join-room', ({ code }) => {
    if (!loggedInUser) { socket.emit('error-msg', { message: 'Please log in first.' }); return; }

    const roomCode = code.toUpperCase();
    let room = rooms.get(roomCode);

    if (!room) {
      room = createRoom(roomCode);
      playerId = 'p1';
      room.players.push({ id: playerId, name: loggedInUser, socketId: socket.id, username: loggedInUser });
      room.scores[playerId] = 0;
      rooms.set(roomCode, room);
      currentRoom = roomCode;
      socket.join(roomCode);

      socket.emit('room-joined', { code: roomCode, playerId, playerName: loggedInUser, waiting: true });
      io.to(roomCode).emit('player-joined', {
        players: room.players.map(p => ({ id: p.id, name: p.name })),
      });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('error-msg', { message: 'Room is full.' });
      return;
    }

    // Don't let same user join twice
    if (room.players.some(p => p.username.toLowerCase() === loggedInUser.toLowerCase())) {
      socket.emit('error-msg', { message: "You're already in this room!" });
      return;
    }

    playerId = 'p2';
    room.players.push({ id: playerId, name: loggedInUser, socketId: socket.id, username: loggedInUser });
    room.scores[playerId] = 0;
    currentRoom = roomCode;
    socket.join(roomCode);

    socket.emit('room-joined', { code: roomCode, playerId, playerName: loggedInUser, waiting: false });
    io.to(roomCode).emit('player-joined', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
    });
  });

  socket.on('start-game', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.players.length < 2) return;
    if (room.phase !== 'lobby') return;

    room.phase = 'playing';
    room.round = 0;
    room.turnIndex = 0;

    io.to(currentRoom).emit('game-started', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      scores: room.scores,
      totalRounds: room.totalRounds,
    });

    startTurn(room);
  });

  socket.on('ring-bell', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'describing') return;
    const guesser = getGuesser(room);
    if (guesser.socketId !== socket.id) return;
    endTurn(room, 'bell');
  });

  socket.on('correct-guess', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'describing') return;
    endTurn(room, 'guessed');
  });

  socket.on('skip-card', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'describing') return;
    const describer = getDescriber(room);
    if (describer.socketId !== socket.id) return;
    endTurn(room, 'skip');
  });

  socket.on('next-turn', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'roundEnd') return;
    if (room.round >= room.totalRounds) return;
    startTurn(room);
  });

  socket.on('play-again', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.round = 0;
    room.turnIndex = 0;
    room.deck = shuffleArray(WORDS);
    room.deckIndex = 0;
    room.activeRules = [];
    room.availableRules = shuffleArray(CHALLENGE_RULES);
    room.ruleIndex = 0;
    room.phase = 'lobby';
    room.currentWord = null;
    room.turnStats = {
      p1: { bellsCaught: 0, wordsDescribed: 0, umsGotten: 0 },
      p2: { bellsCaught: 0, wordsDescribed: 0, umsGotten: 0 },
    };
    for (const p of room.players) {
      room.scores[p.id] = 0;
    }

    io.to(currentRoom).emit('game-reset', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      scores: room.scores,
    });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    clearInterval(room.timer);
    room.players = room.players.filter(p => p.socketId !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(currentRoom);
    } else {
      io.to(currentRoom).emit('player-left', {
        message: 'Your opponent disconnected.',
        players: room.players.map(p => ({ id: p.id, name: p.name })),
      });
      room.phase = 'lobby';
    }
  });
});

// ── Start server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`"You Can't Say Um!" is running at http://localhost:${PORT}`);
});
