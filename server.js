/**
 * Block Ops – Online  |  Relay Server
 * Run:  node server.js
 * Then open:  http://localhost:3000
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const gameHtml = fs.readFileSync(path.join(__dirname, 'game.html'));

// ── HTTP server – serves the game page ──────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(gameHtml);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ── Socket.io – real-time relay + room management ───────────────────────────
const io = new Server(httpServer, {
  path: '/api/socket.io',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

const rooms      = new Map(); // code -> Room
const socketRoom = new Map(); // socketId -> 'room_CODE'

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function cleanRoom(code) {
  const r = rooms.get(code);
  if (r && r.players.length === 0) rooms.delete(code);
}

io.on('connection', (socket) => {

  // General join (subscribe to a socket.io room after create/join)
  socket.on('join', (data) => {
    const room = data?.room ?? 'blockops_main';
    socket.join(room);
    if (!socketRoom.has(socket.id)) socketRoom.set(socket.id, room);
    socket.to(room).emit('message', JSON.stringify({
      type: 'player_join', id: socket.id,
      name: data?.name ?? 'Player', room,
    }));
  });

  // Create a room ─ responds with { ok, room }
  socket.on('room_create', (data, ack) => {
    let code = genCode();
    while (rooms.has(code)) code = genCode();
    const room = {
      code,
      name:       data?.name || (data?.hostName ?? 'Player') + "'s Room",
      host:       data?.hostName ?? 'Player',
      hostId:     socket.id,
      maxPlayers: data?.maxPlayers ?? 4,
      players:    [{ id: socket.id, name: data?.hostName ?? 'Player' }],
      created:    Date.now(),
    };
    rooms.set(code, room);
    socketRoom.set(socket.id, 'room_' + code);
    socket.join('room_' + code);
    console.log(`[room] created  ${code}  by ${room.host}`);
    ack({ ok: true, room });
  });

  // Join a room by code ─ responds with { ok, room } or { ok:false, msg }
  socket.on('room_join', (data, ack) => {
    const code = (data?.code ?? '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room)                              return ack({ ok: false, msg: 'Room not found. Check the code!' });
    if (room.players.length >= room.maxPlayers) return ack({ ok: false, msg: 'Room is full!' });
    room.players = room.players.filter(p => p.id !== socket.id);
    room.players.push({ id: socket.id, name: data?.name ?? 'Player' });
    socketRoom.set(socket.id, 'room_' + code);
    socket.join('room_' + code);
    socket.to('room_' + code).emit('message', JSON.stringify({
      type: 'room_join', id: socket.id,
      name: data?.name ?? 'Player', room: 'room_' + code,
    }));
    console.log(`[room] ${data?.name} joined ${code}`);
    ack({ ok: true, room });
  });

  // Get a room (lobby refresh)
  socket.on('room_get', (data, ack) => {
    const code = (data?.code ?? '').toUpperCase().trim();
    ack(rooms.get(code) ?? null);
  });

  // Leave a room
  socket.on('room_leave', (data) => {
    const code = (data?.code ?? '').toUpperCase().trim();
    const room = rooms.get(code);
    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);
      socket.to('room_' + code).emit('message', JSON.stringify({
        type: 'room_leave', id: socket.id, room: 'room_' + code,
      }));
      cleanRoom(code);
    }
    socketRoom.delete(socket.id);
    socket.leave('room_' + code);
  });

  // List all open rooms
  socket.on('room_list', (_data, ack) => {
    for (const [code, room] of rooms) {
      if (Date.now() - room.created > 7_200_000 && room.players.length === 0)
        rooms.delete(code);
    }
    ack(Array.from(rooms.values()));
  });

  // Relay generic game messages (positions, bullets, hits …)
  socket.on('message', (raw) => {
    try {
      const msg  = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const room = msg?.room ?? socketRoom.get(socket.id) ?? 'blockops_main';
      socket.to(room).emit('message', typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch { /* ignore malformed */ }
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    const room = socketRoom.get(socket.id);
    if (room) {
      const code = room.replace(/^room_/, '');
      const r = rooms.get(code);
      if (r) {
        r.players = r.players.filter(p => p.id !== socket.id);
        socket.to(room).emit('message', JSON.stringify({
          type: 'leave', id: socket.id, room,
        }));
        cleanRoom(code);
      }
      socketRoom.delete(socket.id);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log('  ║   Block Ops – Online  |  Server   ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log('');
  console.log('  Share your public IP or use ngrok for');
  console.log('  cross-country play with friends.');
  console.log('');
});
