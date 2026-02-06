const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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

// ── Challenge rules added every other round ─────────────────────────────────
const CHALLENGE_RULES = [
  { id: "no-s-words", text: "No words starting with 'S'" },
  { id: "no-yes-no", text: "Can't say 'Yes' or 'No'" },
  { id: "no-hands", text: "No hand gestures (honor system!)" },
  { id: "no-the-a", text: "Can't say 'the' or 'a'" },
  { id: "third-person", text: "Must speak in third person" },
  { id: "include-color", text: "Must include a color in every sentence" },
  { id: "no-two-syllable-plus", text: "No words with more than 2 syllables" },
  { id: "must-whisper", text: "Must whisper the entire description" },
  { id: "no-rhyming", text: "Can't use words that rhyme with the target word" },
  { id: "backwards-clue", text: "First clue must describe the opposite" },
  { id: "no-body-parts", text: "Can't reference any body parts" },
  { id: "must-sing", text: "Must sing your description (honor system!)" },
  { id: "one-word-clues", text: "Only one-word clues allowed" },
  { id: "no-verbs", text: "Try to avoid verbs (honor system!)" },
  { id: "accent-round", text: "Must use a silly accent (honor system!)" },
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
    players: [],          // [{id, name, socketId}]
    scores: {},           // {playerId: score}
    round: 0,
    turnIndex: 0,         // whose turn (index into players)
    currentWord: null,
    deck: shuffleArray(WORDS),
    deckIndex: 0,
    activeRules: [],
    availableRules: shuffleArray(CHALLENGE_RULES),
    ruleIndex: 0,
    phase: 'lobby',       // lobby | playing | describing | roundEnd | gameOver
    turnTimeLeft: 60,
    timer: null,
    totalRounds: 10,
    cardsPerTurn: 1,
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

  // Send word only to the describer
  io.to(describer.socketId).emit('turn-start', {
    word: room.currentWord,
    role: 'describer',
    round: room.round,
    activeRules: room.activeRules,
    describer: describer.name,
    guesser: guesser.name,
    timeLeft: room.turnTimeLeft,
  });

  // Guesser sees that it's their turn to guess
  io.to(guesser.socketId).emit('turn-start', {
    word: null,
    role: 'guesser',
    round: room.round,
    activeRules: room.activeRules,
    describer: describer.name,
    guesser: guesser.name,
    timeLeft: room.turnTimeLeft,
  });

  // Start countdown
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

function endTurn(room, reason, winnerId) {
  clearInterval(room.timer);
  room.phase = 'roundEnd';

  const describer = getDescriber(room);
  const guesser = getGuesser(room);

  let message = '';
  if (reason === 'bell') {
    room.scores[guesser.id]++;
    message = `🔔 ${guesser.name} rang the bell! They caught an "um"! +1 point for ${guesser.name}`;
  } else if (reason === 'guessed') {
    room.scores[describer.id]++;
    message = `✅ ${guesser.name} guessed it! The word was "${room.currentWord}". +1 point for ${describer.name}`;
  } else if (reason === 'timeout') {
    message = `⏰ Time's up! The word was "${room.currentWord}". No points awarded.`;
  } else if (reason === 'skip') {
    message = `⏭️ Card skipped! The word was "${room.currentWord}".`;
  }

  // Advance turn
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.round++;

  // Check for new rule every other round
  let newRule = null;
  if (room.round > 0 && room.round % 2 === 0) {
    newRule = addChallengeRule(room);
  }

  const gameOver = room.round >= room.totalRounds;

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
  });

  if (gameOver) {
    room.phase = 'gameOver';
  }
}

// ── Socket.io event handling ────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on('create-room', ({ playerName }) => {
    let code;
    do {
      code = generateRoomCode();
    } while (rooms.has(code));

    const room = createRoom(code);
    playerId = 'p1';
    room.players.push({ id: playerId, name: playerName, socketId: socket.id });
    room.scores[playerId] = 0;
    rooms.set(code, room);
    currentRoom = code;
    socket.join(code);

    socket.emit('room-created', { code, playerId, playerName });
  });

  socket.on('join-room', ({ code, playerName }) => {
    const roomCode = code.toUpperCase();
    let room = rooms.get(roomCode);

    // If room doesn't exist, create it and wait for the second player
    if (!room) {
      room = createRoom(roomCode);
      playerId = 'p1';
      room.players.push({ id: playerId, name: playerName, socketId: socket.id });
      room.scores[playerId] = 0;
      rooms.set(roomCode, room);
      currentRoom = roomCode;
      socket.join(roomCode);

      socket.emit('room-joined', { code: roomCode, playerId, playerName, waiting: true });

      io.to(roomCode).emit('player-joined', {
        players: room.players.map(p => ({ id: p.id, name: p.name })),
      });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('error-msg', { message: 'Room is full.' });
      return;
    }

    playerId = 'p2';
    room.players.push({ id: playerId, name: playerName, socketId: socket.id });
    room.scores[playerId] = 0;
    currentRoom = roomCode;
    socket.join(roomCode);

    socket.emit('room-joined', { code: roomCode, playerId, playerName, waiting: false });

    // Notify both players that the room is full and ready
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
    if (guesser.socketId !== socket.id) return; // only guesser can ring

    endTurn(room, 'bell');
  });

  socket.on('correct-guess', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'describing') return;

    // Either player can confirm the guess was correct
    endTurn(room, 'guessed');
  });

  socket.on('skip-card', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'describing') return;

    const describer = getDescriber(room);
    if (describer.socketId !== socket.id) return; // only describer can skip

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

    // Reset game state
    room.round = 0;
    room.turnIndex = 0;
    room.deck = shuffleArray(WORDS);
    room.deckIndex = 0;
    room.activeRules = [];
    room.availableRules = shuffleArray(CHALLENGE_RULES);
    room.ruleIndex = 0;
    room.phase = 'lobby';
    room.currentWord = null;
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
