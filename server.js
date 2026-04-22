const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomBytes } = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const lobbies = new Map();

function generateCode() {
  return randomBytes(2).toString("hex").toUpperCase();
}

function getPlayerIndex(lobby, socketId) {
  return lobby.players.findIndex((p) => p.id === socketId);
}

function broadcastLobbyState(lobby) {
  for (const p of lobby.players) {
    io.to(p.id).emit("lobby:update", {
      players: lobby.players.map((pl) => ({
        name: pl.name,
        ready: pl.ready,
        isYou: pl.id === p.id,
      })),
      sentenceCount: lobby.sentenceCount,
      host: lobby.players[0].id === p.id,
    });
  }
}

function sendRoundState(lobby, playerIdx) {
  const p = lobby.players[playerIdx];
  const round = lobby.currentRound;

  // Which story this player writes to this round
  const storyIdx = (playerIdx + round) % 2;
  const story = lobby.stories[storyIdx];

  // Only send the last sentence of that story as context (if any)
  const lastSentence = story.length > 0 ? story[story.length - 1] : null;
  const storyOwner = lobby.players[storyIdx].name;

  const partnerIdx = 1 - playerIdx;
  const partnerSubmitted = lobby.submittedThisRound.has(partnerIdx);

  io.to(p.id).emit("game:round", {
    round,
    totalRounds: lobby.sentenceCount,
    storyIdx,
    storyOwnerName: storyOwner,
    lastSentence,
    hasSubmitted: lobby.submittedThisRound.has(playerIdx),
    partnerSubmitted,
    isStarting: story.length === 0,
    storyLength: story.length,
  });
}

function broadcastRoundState(lobby) {
  for (let i = 0; i < lobby.players.length; i++) {
    sendRoundState(lobby, i);
  }
}

io.on("connection", (socket) => {
  socket.on("lobby:create", ({ name }) => {
    let code;
    do {
      code = generateCode();
    } while (lobbies.has(code));

    const lobby = {
      code,
      players: [{ id: socket.id, name, ready: false }],
      sentenceCount: 8,
      stories: [[], []],
      currentRound: 0,
      submittedThisRound: new Set(),
      started: false,
    };
    lobbies.set(code, lobby);
    socket.join(code);
    socket.lobbyCode = code;
    socket.emit("lobby:created", { code });
    broadcastLobbyState(lobby);
  });

  socket.on("lobby:join", ({ code, name }) => {
    const lobby = lobbies.get(code.toUpperCase());
    if (!lobby) return socket.emit("error", "Lobby not found");
    if (lobby.started) return socket.emit("error", "Game already started");
    if (lobby.players.length >= 2)
      return socket.emit("error", "Lobby is full");

    lobby.players.push({ id: socket.id, name, ready: false });
    socket.join(code);
    socket.lobbyCode = code;
    socket.emit("lobby:joined", { code });
    broadcastLobbyState(lobby);
  });

  socket.on("lobby:ready", () => {
    const lobby = lobbies.get(socket.lobbyCode);
    if (!lobby) return;
    const player = lobby.players.find((p) => p.id === socket.id);
    if (!player) return;
    player.ready = !player.ready;
    broadcastLobbyState(lobby);

    if (lobby.players.length === 2 && lobby.players.every((p) => p.ready)) {
      lobby.started = true;
      lobby.stories = [[], []];
      lobby.currentRound = 0;
      lobby.submittedThisRound = new Set();
      for (const p of lobby.players) {
        io.to(p.id).emit("game:start");
      }
      broadcastRoundState(lobby);
    }
  });

  socket.on("lobby:setSentences", ({ count }) => {
    const lobby = lobbies.get(socket.lobbyCode);
    if (!lobby || lobby.started) return;
    if (lobby.players[0].id !== socket.id) return;
    lobby.sentenceCount = count;
    broadcastLobbyState(lobby);
  });

  socket.on("game:submit", ({ text }) => {
    const lobby = lobbies.get(socket.lobbyCode);
    if (!lobby || !lobby.started) return;

    const playerIdx = getPlayerIndex(lobby, socket.id);
    if (playerIdx === -1) return;
    if (lobby.submittedThisRound.has(playerIdx)) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    // Determine which story this player contributes to this round
    const storyIdx = (playerIdx + lobby.currentRound) % 2;
    const player = lobby.players[playerIdx];

    lobby.stories[storyIdx].push({ text: trimmed, author: player.name });
    lobby.submittedThisRound.add(playerIdx);

    // Notify the partner that this player submitted
    const partnerIdx = 1 - playerIdx;
    const partner = lobby.players[partnerIdx];
    io.to(partner.id).emit("game:partnerSubmitted");

    // Check if both players submitted this round
    if (lobby.submittedThisRound.size === 2) {
      lobby.currentRound++;
      lobby.submittedThisRound = new Set();

      if (lobby.currentRound >= lobby.sentenceCount) {
        // Game over — reveal both stories
        for (let i = 0; i < lobby.players.length; i++) {
          io.to(lobby.players[i].id).emit("game:finish", {
            stories: [
              {
                owner: lobby.players[0].name,
                sentences: lobby.stories[0],
              },
              {
                owner: lobby.players[1].name,
                sentences: lobby.stories[1],
              },
            ],
          });
        }
        lobbies.delete(socket.lobbyCode);
      } else {
        broadcastRoundState(lobby);
      }
    }
  });

  socket.on("game:typing", () => {
    const lobby = lobbies.get(socket.lobbyCode);
    if (!lobby || !lobby.started) return;
    const playerIdx = getPlayerIndex(lobby, socket.id);
    if (lobby.submittedThisRound.has(playerIdx)) return;
    const other = lobby.players[1 - playerIdx];
    if (other) io.to(other.id).emit("game:partnerTyping");
  });

  socket.on("game:stopTyping", () => {
    const lobby = lobbies.get(socket.lobbyCode);
    if (!lobby || !lobby.started) return;
    const playerIdx = getPlayerIndex(lobby, socket.id);
    if (lobby.submittedThisRound.has(playerIdx)) return;
    const other = lobby.players[1 - playerIdx];
    if (other) io.to(other.id).emit("game:partnerStopTyping");
  });

  socket.on("playAgain", () => {
    const code = socket.lobbyCode;
    if (!code) return;
    const lobby = lobbies.get(code);
    if (!lobby) return;

    const player = lobby.players.find((p) => p.id === socket.id);
    if (!player) return;
    player.wantsReplay = true;
    player.ready = false;

    if (lobby.players.every((p) => p.wantsReplay)) {
      lobby.started = false;
      lobby.stories = [[], []];
      lobby.currentRound = 0;
      lobby.submittedThisRound = new Set();
      for (const p of lobby.players) {
        p.ready = false;
        p.wantsReplay = false;
      }
      for (const p of lobby.players) {
        io.to(p.id).emit("lobby:joined", { code });
      }
      broadcastLobbyState(lobby);
    }
  });

  socket.on("disconnect", () => {
    if (!socket.lobbyCode) return;
    const lobby = lobbies.get(socket.lobbyCode);
    if (!lobby) return;
    lobby.players = lobby.players.filter((p) => p.id !== socket.id);
    if (lobby.players.length === 0) {
      lobbies.delete(socket.lobbyCode);
    } else {
      const other = lobby.players[0];
      io.to(other.id).emit("partner:disconnected");
      other.ready = false;
      other.wantsReplay = false;
      lobby.started = false;
      lobby.stories = [[], []];
      lobby.currentRound = 0;
      lobby.submittedThisRound = new Set();
      broadcastLobbyState(lobby);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`mystery-story running on http://localhost:${PORT}`);
});
