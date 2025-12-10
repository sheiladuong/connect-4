import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import sanitizeHtml from "sanitize-html";
import cors from "cors";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { Pool } from "pg";
import fetch from 'node-fetch';

const app = express();
const httpServer = createServer(app);
const dotenv = require("dotenv").config();

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const TOKEN_SECRET = "tokensecret"; // for signing nonces

// store registration tokens
interface RegistrationToken {
  token: string;
  ip: string;
  userAgent: string;
  timestamp: number;
  expiresAt: number;
}

interface LobbyMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  ts: string; // timestamp
  system?: boolean;
}

const registrationTokens = new Map<string, RegistrationToken>();

// clean up expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of registrationTokens.entries()) {
    if (now > data.expiresAt) {
      registrationTokens.delete(token);
    }
  }
}, 5 * 60 * 1000);

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const {PGHOST, PGDATABASE, PGUSER, PGPASSWORD} = process.env;

const pool = new Pool({
  host: PGHOST,
  database: PGDATABASE,
  user: PGUSER,
  password: PGPASSWORD,
  port: 5432,
  ssl: { rejectUnauthorized: false } 
});

app.get('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT username FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed' });
  } finally {
    client.release();
  }
});

// auth routes
// get registration token when registration page loads
app.get('/api/register-token', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const timestamp = Date.now();
  const expiresAt = timestamp + (10 * 60 * 1000); // 10 minutes

  // create token with IP, user agent, and timestamp
  const tokenData = `${ip}|${userAgent}|${timestamp}`;
  const token = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(tokenData)
    .digest('hex');

  // Store token
  registrationTokens.set(token, {
    token,
    ip,
    userAgent,
    timestamp,
    expiresAt
  });

  console.log(`Generated registration token for IP ${ip}`);
  
  res.json({ token });
});

// registration endpoint with token validation
app.post('/api/register', async (req, res): Promise<any> => {
  const { username, password, token, captchaToken } = req.body;

  // validate input
  if (!username || !password || !token) {
    return res.status(400).json({ error: 'Username, password, and token are required' });
  }

  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ error: 'Username must be between 3 and 50 characters' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // validate registration token
  const storedToken = registrationTokens.get(token);
  
  if (!storedToken) {
    console.log(`Invalid token attempt: ${token}`);
    return res.status(403).json({ error: 'Invalid or expired registration token' });
  }

  const currentIp = req.ip || req.socket.remoteAddress || 'unknown';
  const currentUserAgent = req.headers['user-agent'] || 'unknown';
  const now = Date.now();

  // validate token hasn't expired
  if (now > storedToken.expiresAt) {
    registrationTokens.delete(token);
    console.log(`Expired token attempt from IP ${currentIp}`);
    return res.status(403).json({ error: 'Registration token has expired. Please refresh the page.' });
  }

  // validate IP matches
  if (storedToken.ip !== currentIp) {
    console.log(`IP mismatch: stored=${storedToken.ip}, current=${currentIp}`);
    return res.status(403).json({ error: 'Registration token validation failed (IP mismatch)' });
  }

  // validate user agent matches
  if (storedToken.userAgent !== currentUserAgent) {
    console.log(`User agent mismatch for IP ${currentIp}`);
    return res.status(403).json({ error: 'Registration token validation failed (browser mismatch)' });
  }

  // validate CAPTCHA
  // get reCAPTCHA secret from env
  const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;

  // validate CAPTCHA with google
  if (!captchaToken) {
    return res.status(400).json({ error: 'CAPTCHA verification required' });
  }

  try {
    const verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
    const verifyResponse = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `secret=${RECAPTCHA_SECRET}&response=${captchaToken}`
    });

    const verifyData = await verifyResponse.json() as { success: boolean };
    
    if (!verifyData.success) {
      console.log('reCAPTCHA verification failed:', verifyData);
      return res.status(403).json({ error: 'CAPTCHA verification failed. Please try again.' });
    }
  } catch (captchaError) {
    console.error('reCAPTCHA verification error:', captchaError);
    return res.status(500).json({ error: 'CAPTCHA verification failed. Please try again.' });
  }

  try {
    // check if username already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // hash password with bcrypt
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // insert new user
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username, password_hash]
    );

    // delete used token
    registrationTokens.delete(token);
    
    console.log(`User ${username} registered successfully from IP ${currentIp}`);

    res.status(201).json({
      message: 'User registered successfully',
      userId: result.rows[0].id
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// login endpoint
app.post('/api/login', async (req, res): Promise<any> => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// chat message routes
// get recent lobby messages
app.get('/api/lobby-messages', async (req, res): Promise<any> => {
  try {
    const result = await pool.query(
      `SELECT id, user_id as "userId", username, text, created_at as ts, is_system as system 
       FROM lobby_messages 
       ORDER BY created_at DESC 
       LIMIT 100`
    );
    
    // reverse to get msgs in chronological order
    res.json(result.rows.reverse());
  } catch (error) {
    console.error('Error fetching lobby messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// get game messages for a specific game
app.get('/api/game-messages/:gameId', async (req, res): Promise<any> => {
  const { gameId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT id, user_id as "userId", username, text, created_at as ts 
       FROM game_messages 
       WHERE game_id = $1 
       ORDER BY created_at ASC`,
      [gameId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching game messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// challenge system and game logic
interface OnlineUser {
  socketId: string;
  userId: string;
  username: string;
}

interface Challenge {
  id: string;
  from: string;
  fromUsername: string;
  fromUserId: string;
  to: string;
  toUsername: string;
  toUserId: string;
  timeout: NodeJS.Timeout;
}

interface GameData {
  id: string;
  board: (string | null)[][];
  currentTurn: "red" | "yellow";
  players: {
    red: { socketId: string; userId: string; username: string };
    yellow: { socketId: string; userId: string; username: string };
  };
  winner: string | null;
  winningCells: number[][] | null;
}

const onlineUsers = new Map<string, OnlineUser>();
const activeChallenges = new Map<string, Challenge>();
const activeGames = new Map<string, GameData>();

// create empty board function
function createEmptyBoard(): (string | null)[][] {
  return Array(6).fill(null).map(() => Array(7).fill(null));
}

// check for winner function
function checkWinner(board: (string | null)[][], row: number, col: number): { winner: string | null; cells: number[][] | null } {
  const currentRow = board[row];
  if (!currentRow) return { winner: null, cells: null };
  
  const player = currentRow[col];
  if (!player) return { winner: null, cells: null };

  // directions: horizontal, vertical, diagonal-right, diagonal-left
  const directions: [[number, number], [number, number]][] = [
    [[0, 1], [0, -1]], // horizontal
    [[1, 0], [-1, 0]], // vertical
    [[1, 1], [-1, -1]], // diagonal right
    [[1, -1], [-1, 1]]  // diagonal left
  ];

  for (const direction of directions) {
    const dir1: [number, number] = direction[0];
    const dir2: [number, number] = direction[1];
    const cells: number[][] = [[row, col]];
    
    // check in first direction
    let r = row + dir1[0];
    let c = col + dir1[1];
    while (r >= 0 && r < 6 && c >= 0 && c < 7) {
      const checkRow = board[r];
      if (!checkRow || checkRow[c] !== player) break;
      cells.push([r, c]);
      r += dir1[0];
      c += dir1[1];
    }
    
    // check in opposite direction
    r = row + dir2[0];
    c = col + dir2[1];
    while (r >= 0 && r < 6 && c >= 0 && c < 7) {
      const checkRow = board[r];
      if (!checkRow || checkRow[c] !== player) break;
      cells.push([r, c]);
      r += dir2[0];
      c += dir2[1];
    }
    
    if (cells.length >= 4) {
      return { winner: player, cells };
    }
  }
  
  return { winner: null, cells: null };
}

// check if board is full (draw)
function isBoardFull(board: (string | null)[][]): boolean {
  const topRow = board[0];
  if (!topRow) return false;
  return topRow.every(cell => cell !== null);
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Handle user joining lobby
  socket.on("joinLobby", async ({ userId, username }) => {
    if (socket.data.hasJoinedLobby) {
      return;
    }
    socket.data.hasJoinedLobby = true;

    socket.join("main");
    socket.data.username = username;
    socket.data.userId = userId;

    // remove old socket entries for the user
    for (const [socketId, user] of onlineUsers.entries()) {
      if (user.userId === userId && socketId !== socket.id) {
        onlineUsers.delete(socketId);
        console.log(`Removed old socket ${socketId} for user ${username}`);
      }
    }

    // add user to online users
    onlineUsers.set(socket.id, {
      socketId: socket.id,
      userId,
      username
    });

    // display updated online users list
    const usersList = Array.from(onlineUsers.values());
    io.to("main").emit("onlineUsers", usersList);
    
    // send join message to lobby chat
    const msgId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    const joinMsg: LobbyMessage = {
      id: msgId,
      userId: "system",
      username: "System",
      text: `${username} joined the lobby`,
      ts: timestamp,
      system: true,
    };

    // save to database
    try {
      await pool.query(
        'INSERT INTO lobby_messages (id, user_id, username, text, created_at, is_system) VALUES ($1, $2, $3, $4, $5, $6)',
        [msgId, "system", "System", joinMsg.text, timestamp, true]
      );
    } catch (error) {
      console.error('Error saving system message:', error);
    }

    io.to("main").emit("newLobbyMessage", joinMsg);

    console.log(`${username} joined lobby. Total users: ${onlineUsers.size}`);
  });

  // handle lobby chat messages
  socket.on("sendLobbyMessage", async ({ text }: { text: string }) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;

    const clean = sanitizeHtml(text, { 
      allowedTags: [], 
      allowedAttributes: {} 
    }).trim();
    
    if (!clean) return;

    const msgId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const msg: LobbyMessage = {
      id: msgId,
      userId: user.userId,
      username: user.username,
      text: clean,
      ts: timestamp,
    };

    // save to database
    try {
      await pool.query(
        'INSERT INTO lobby_messages (id, user_id, username, text, created_at, is_system) VALUES ($1, $2, $3, $4, $5, $6)',
        [msgId, user.userId, user.username, clean, timestamp, false]
      );
    } catch (error) {
      console.error('Error saving lobby message:', error);
    }

    io.to("main").emit("newLobbyMessage", msg);
  });

  // handle challenge sent
  socket.on("sendChallenge", ({ to, toUsername }) => {
    const challenger = onlineUsers.get(socket.id);
    const opponent = onlineUsers.get(to);
    if (!challenger || !opponent) return;

    const challengeId = crypto.randomUUID();

    // set up timeout (10 seconds)
    const timeout = setTimeout(() => {
      socket.emit("challengeTimeout");
      io.to(to).emit("challengeTimeout");
      activeChallenges.delete(challengeId);
      console.log(`Challenge ${challengeId} timed out`);
    }, 10000);

    // store challenge with userId info
    activeChallenges.set(challengeId, {
      id: challengeId,
      from: socket.id,
      fromUsername: challenger.username,
      fromUserId: challenger.userId,
      to,
      toUsername: opponent.username,
      toUserId: opponent.userId,
      timeout
    });

    // send challenge to opponent
    io.to(to).emit("challengeReceived", {
      from: socket.id,
      fromUsername: challenger.username,
      to,
      challengeId
    });

    console.log(`${challenger.username} challenged ${toUsername}`);
  });

  // handle challenge accepted
  socket.on("acceptChallenge", ({ challengeId, from }) => {
    const challenge = activeChallenges.get(challengeId);
    if (!challenge) return;

    clearTimeout(challenge.timeout);
    activeChallenges.delete(challengeId);

    const gameId = crypto.randomUUID();

    const game: GameData = {
      id: gameId,
      board: createEmptyBoard(),
      currentTurn: "red",
      players: {
        red: { 
          socketId: challenge.from, 
          userId: challenge.fromUserId, 
          username: challenge.fromUsername 
        },
        yellow: { 
          socketId: challenge.to, 
          userId: challenge.toUserId, 
          username: challenge.toUsername 
        }
      },
      winner: null,
      winningCells: null
    };
    
    activeGames.set(gameId, game);
    console.log(`Game ${gameId} created: ${challenge.fromUsername} (red) vs ${challenge.toUsername} (yellow)`);

    socket.emit("challengeAccepted", { gameId });
    io.to(from).emit("challengeAccepted", { gameId });
  });

  // handle challenge declined
  socket.on("declineChallenge", ({ challengeId, from }) => {
    const challenge = activeChallenges.get(challengeId);
    if (!challenge) return;

    clearTimeout(challenge.timeout);
    activeChallenges.delete(challengeId);

    const decliner = onlineUsers.get(socket.id);
    
    io.to(from).emit("challengeDeclined", { 
      username: decliner?.username || "Opponent" 
    });

    console.log(`${decliner?.username} declined challenge from ${challenge.fromUsername}`);
  });

  // handle player joining game
  socket.on("joinGame", ({ gameId, userId, username }) => {
    socket.join(gameId);
    
    const game = activeGames.get(gameId);
    
    if (!game) {
      console.error(`Game ${gameId} not found when ${username} tried to join`);
      return;
    }

    if (game.players.red.userId === userId) {
      game.players.red.socketId = socket.id;
      console.log(`${username} joined game ${gameId} as red player`);
    } else if (game.players.yellow.userId === userId) {
      game.players.yellow.socketId = socket.id;
      console.log(`${username} joined game ${gameId} as yellow player`);
    } else {
      console.error(`User ${username} (${userId}) is not part of game ${gameId}`);
      return;
    }
    
    io.to(gameId).emit("gameState", {
      board: game.board,
      currentTurn: game.currentTurn,
      players: game.players,
      winner: game.winner,
      winningCells: game.winningCells
    });
  });

  // handle player making a move
  socket.on("makeMove", ({ gameId, col }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    const playerColor = game.players.red.socketId === socket.id ? "red" : "yellow";
    if (game.currentTurn !== playerColor) {
      socket.emit("invalidMove", { message: "It's not your turn!" });
      return;
    }

    if (game.winner) {
      socket.emit("invalidMove", { message: "Game is already over!" });
      return;
    }

    if (col < 0 || col >= 7) {
      socket.emit("invalidMove", { message: "Invalid column!" });
      return;
    }

    let row = -1;
    for (let r = 5; r >= 0; r--) {
      const rowData = game.board[r];
      if (rowData && rowData[col] === null) {
        row = r;
        break;
      }
    }

    if (row === -1) {
      socket.emit("invalidMove", { message: "Column is full!" });
      return;
    }

    const targetRow = game.board[row];
    if (targetRow) {
      targetRow[col] = playerColor;
    }

    const { winner, cells } = checkWinner(game.board, row, col);
    
    if (winner) {
      game.winner = winner;
      game.winningCells = cells;
      io.to(gameId).emit("gameState", {
        board: game.board,
        currentTurn: game.currentTurn,
        players: game.players,
        winner: game.winner,
        winningCells: game.winningCells
      });
      io.to(gameId).emit("gameOver", { winner, winningCells: cells });
      console.log(`Game ${gameId} won by ${winner}`);
      
      setTimeout(() => {
        activeGames.delete(gameId);
        console.log(`Game ${gameId} cleaned up`);
      }, 30000);
    } else if (isBoardFull(game.board)) {
      game.winner = "draw";
      io.to(gameId).emit("gameState", {
        board: game.board,
        currentTurn: game.currentTurn,
        players: game.players,
        winner: "draw",
        winningCells: null
      });
      io.to(gameId).emit("gameOver", { winner: "draw", winningCells: null });
      console.log(`Game ${gameId} ended in a draw`);
      
      setTimeout(() => {
        activeGames.delete(gameId);
        console.log(`Game ${gameId} cleaned up`);
      }, 30000);
    } else {
      game.currentTurn = game.currentTurn === "red" ? "yellow" : "red";
      
      io.to(gameId).emit("gameState", {
        board: game.board,
        currentTurn: game.currentTurn,
        players: game.players,
        winner: game.winner,
        winningCells: game.winningCells
      });
    }
  });

  // handle player forfeiting
  socket.on("forfeitGame", ({ gameId }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    const forfeiter = game.players.red.socketId === socket.id 
      ? game.players.red 
      : game.players.yellow;
    
    const opponent = game.players.red.socketId === socket.id 
      ? game.players.yellow 
      : game.players.red;

    io.to(opponent.socketId).emit("opponentForfeited", { username: forfeiter.username });

    activeGames.delete(gameId);
    console.log(`${forfeiter.username} forfeited game ${gameId}`);
  });

  // handle game chat messages
  socket.on("sendGameMessage", async ({ gameId, text }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    const player = game.players.red.socketId === socket.id 
      ? game.players.red 
      : game.players.yellow;

    const clean = sanitizeHtml(text, { 
      allowedTags: [], 
      allowedAttributes: {} 
    }).trim();
    
    if (!clean) return;

    const msgId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const msg = {
      id: msgId,
      userId: player.userId,
      username: player.username,
      text: clean,
      ts: timestamp
    };

    // save to database
    try {
      await pool.query(
        'INSERT INTO game_messages (id, game_id, user_id, username, text, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [msgId, gameId, player.userId, player.username, clean, timestamp]
      );
    } catch (error) {
      console.error('Error saving game message:', error);
    }

    io.to(gameId).emit("newGameMessage", msg);
  });

  // handle disconnect
  socket.on("disconnect", async () => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;

    onlineUsers.delete(socket.id);

    activeChallenges.forEach((challenge, challengeId) => {
      if (challenge.from === socket.id || challenge.to === socket.id) {
        clearTimeout(challenge.timeout);
        
        const otherSocket = challenge.from === socket.id ? challenge.to : challenge.from;
        io.to(otherSocket).emit("challengeTimeout");
        
        activeChallenges.delete(challengeId);
      }
    });

    const usersList = Array.from(onlineUsers.values());
    io.to("main").emit("onlineUsers", usersList);

    const msgId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const leaveMsg: LobbyMessage = {
      id: msgId,
      userId: "system",
      username: "System",
      text: `${user.username} left the lobby`,
      ts: timestamp,
      system: true,
    };

    // save to database
    try {
      await pool.query(
        'INSERT INTO lobby_messages (id, user_id, username, text, created_at, is_system) VALUES ($1, $2, $3, $4, $5, $6)',
        [msgId, "system", "System", leaveMsg.text, timestamp, true]
      );
    } catch (error) {
      console.error('Error saving system message:', error);
    }

    io.to("main").emit("newLobbyMessage", leaveMsg);

    console.log(`${user.username} left lobby. Total users: ${onlineUsers.size}`);
  }); 
   
});

httpServer.listen(3001, () => console.log("Server running on 3001"));