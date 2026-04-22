const socket = io();

const $ = (sel) => document.querySelector(sel);

// Elements
const screens = {
  home: $("#screen-home"),
  lobby: $("#screen-lobby"),
  game: $("#screen-game"),
  finish: $("#screen-finish"),
};

const nameInput = $("#name-input");
const codeInput = $("#code-input");
const btnCreate = $("#btn-create");
const btnJoin = $("#btn-join");
const lobbyCodeEl = $("#lobby-code");
const lobbyPlayersEl = $("#lobby-players");
const sentenceOptionsEl = $("#sentence-options");
const btnReady = $("#btn-ready");
const roundIndicator = $("#round-indicator");
const progressFill = $("#progress-fill");
const contextArea = $("#context-area");
const contextOwner = $("#context-owner");
const contextSentence = $("#context-sentence");
const contextEmpty = $("#context-empty");
const gameInputArea = $("#game-input-area");
const submittedArea = $("#submitted-area");
const sentenceInput = $("#sentence-input");
const btnSubmit = $("#btn-submit");
const inputHint = $("#input-hint");
const typingIndicator = $("#typing-indicator");
const finalStories = $("#final-stories");
const btnCopy = $("#btn-copy");
const btnAgain = $("#btn-again");
const btnHome = $("#btn-home");
const disconnectOverlay = $("#disconnect-overlay");
const toastEl = $("#toast");

// State
let currentScreen = "home";
let gameState = null;
let hasSubmitted = false;
let typingTimeout = null;

// --- SCREEN MANAGEMENT ---
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
  currentScreen = name;
}

// --- TOAST ---
function showToast(msg, duration = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove("show");
  }, duration);
}

// --- HOME ---
btnCreate.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    showToast("enter your name");
    return;
  }
  socket.emit("lobby:create", { name });
});

btnJoin.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) {
    nameInput.focus();
    showToast("enter your name");
    return;
  }
  if (!code || code.length < 4) {
    codeInput.focus();
    showToast("enter a lobby code");
    return;
  }
  socket.emit("lobby:join", { code, name });
});

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnCreate.click();
});

codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnJoin.click();
});

// --- LOBBY ---
const ROUND_OPTIONS = [4, 6, 8, 10, 12];

function renderSentenceOptions(count, host) {
  sentenceOptionsEl.innerHTML = "";
  ROUND_OPTIONS.forEach((n) => {
    const btn = document.createElement("button");
    btn.className =
      "sentence-opt" + (n === count ? " active" : "") + (!host ? " disabled" : "");
    btn.textContent = n;
    if (host) {
      btn.addEventListener("click", () => {
        socket.emit("lobby:setSentences", { count: n });
      });
    }
    sentenceOptionsEl.appendChild(btn);
  });
}

function renderLobbyPlayers(players) {
  lobbyPlayersEl.innerHTML = "";
  players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "player-item";
    const statusClass = p.ready ? "ready" : "waiting";
    const statusText = p.ready ? "ready" : "not ready";
    div.innerHTML = `<span class="name">${esc(p.name)}${p.isYou ? " (you)" : ""}</span>
      <span class="status ${statusClass}">${statusText}</span>`;
    lobbyPlayersEl.appendChild(div);
  });
  if (players.length < 2) {
    const empty = document.createElement("div");
    empty.className = "player-slot-empty";
    empty.textContent = "waiting for partner...";
    lobbyPlayersEl.appendChild(empty);
  }
}

btnReady.addEventListener("click", () => {
  socket.emit("lobby:ready");
});

// --- GAME ---
function renderRound(data) {
  gameState = data;
  hasSubmitted = data.hasSubmitted;

  // Progress
  const pct = (data.round / data.totalRounds) * 100;
  progressFill.style.width = pct + "%";

  // Round indicator
  roundIndicator.innerHTML = `round <span class="highlight">${data.round + 1}</span> of ${data.totalRounds}`;

  // Context — the last sentence the player needs to continue from
  if (data.isStarting) {
    contextArea.classList.remove("hidden");
    contextSentence.style.display = "none";
    contextEmpty.style.display = "";
    contextOwner.textContent = data.storyOwnerName;
    $("#context-label").textContent = "starting a new story";
  } else if (data.lastSentence) {
    contextArea.classList.remove("hidden");
    contextSentence.style.display = "";
    contextEmpty.style.display = "none";
    contextSentence.textContent = data.lastSentence.text;
    contextOwner.textContent = data.storyOwnerName;
  }

  // Toggle input vs submitted
  if (hasSubmitted) {
    gameInputArea.classList.add("hidden");
    submittedArea.classList.remove("hidden");
  } else {
    gameInputArea.classList.remove("hidden");
    submittedArea.classList.add("hidden");
    sentenceInput.value = "";
    sentenceInput.focus();
    inputHint.textContent = `sentence ${data.storyLength + 1} of ${data.storyOwnerName}'s story`;
    btnSubmit.disabled = false;
  }
}

// Submit
function submitSentence() {
  const text = sentenceInput.value.trim();
  if (!text) return;
  btnSubmit.disabled = true;
  hasSubmitted = true;
  gameInputArea.classList.add("hidden");
  submittedArea.classList.remove("hidden");
  typingIndicator.classList.add("hidden");
  socket.emit("game:submit", { text });
}

btnSubmit.addEventListener("click", submitSentence);
sentenceInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitSentence();
});

// Typing indicators
sentenceInput.addEventListener("input", () => {
  if (hasSubmitted) return;
  socket.emit("game:typing");
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("game:stopTyping");
  }, 800);
});

sentenceInput.addEventListener("blur", () => {
  clearTimeout(typingTimeout);
  socket.emit("game:stopTyping");
});

// --- FINISH ---
const SENTENCE_DELAY = 1000;
const STORY_GAP = 5000;

function renderFinish(stories) {
  finalStories.innerHTML = "";
  const finishActions = $(".finish-actions");
  finishActions.classList.remove("visible");

  // Build DOM for both stories upfront, all hidden
  const storyData = stories.map((story, idx) => {
    const heading = document.createElement("div");
    heading.className = "story-heading";
    heading.textContent = `story ${idx + 1}`;
    finalStories.appendChild(heading);

    const textEl = document.createElement("div");
    textEl.className = "story-text";
    const sentenceEls = story.sentences.map((s) => {
      const span = document.createElement("span");
      span.className = "sentence";
      span.innerHTML = `${esc(s.text)}<span class="author">${esc(s.author)}</span> `;
      textEl.appendChild(span);
      return span;
    });
    finalStories.appendChild(textEl);

    return { heading, sentenceEls };
  });

  // Reveal story 1 heading, then its sentences, wait, then story 2
  let delay = 500;

  storyData.forEach(({ heading, sentenceEls }, idx) => {
    // Show heading
    setTimeout(() => {
      heading.classList.add("visible");
    }, delay);
    delay += 800;

    // Reveal sentences one by one
    sentenceEls.forEach((el) => {
      setTimeout(() => {
        el.classList.add("visible");
      }, delay);
      delay += SENTENCE_DELAY;
    });

    // Gap before next story (or before buttons if last story)
    if (idx < storyData.length - 1) {
      delay += STORY_GAP;
    }
  });

  // Show buttons after everything
  setTimeout(() => {
    finishActions.classList.add("visible");
  }, delay + 600);
}

btnCopy.addEventListener("click", () => {
  if (!gameState || !gameState.stories) return;
  const text = gameState.stories
    .map(
      (s) =>
        `${s.owner}'s story:\n` +
        s.sentences.map((x) => x.text).join(" ")
    )
    .join("\n\n");
  navigator.clipboard.writeText(text).then(() => {
    showToast("copied to clipboard");
  });
});

btnAgain.addEventListener("click", () => {
  socket.emit("playAgain");
  showScreen("lobby");
});

btnHome.addEventListener("click", () => {
  disconnectOverlay.classList.add("hidden");
  showScreen("home");
  nameInput.value = "";
  codeInput.value = "";
});

// --- SOCKET EVENTS ---
socket.on("lobby:created", ({ code }) => {
  lobbyCodeEl.textContent = code;
  showScreen("lobby");
});

socket.on("lobby:joined", ({ code }) => {
  lobbyCodeEl.textContent = code;
  showScreen("lobby");
});

socket.on("lobby:update", (data) => {
  renderLobbyPlayers(data.players);
  renderSentenceOptions(data.sentenceCount, data.host);
  btnReady.textContent =
    data.players.find((p) => p.isYou)?.ready ? "not ready" : "ready";
});

socket.on("game:start", () => {
  showScreen("game");
});

socket.on("game:round", (data) => {
  renderRound(data);
});

socket.on("game:partnerSubmitted", () => {
  // Partner submitted — if we already submitted too, a new round event will come
});

socket.on("game:partnerTyping", () => {
  if (!hasSubmitted) {
    typingIndicator.classList.remove("hidden");
  }
});

socket.on("game:partnerStopTyping", () => {
  typingIndicator.classList.add("hidden");
});

socket.on("game:finish", ({ stories }) => {
  gameState = { stories };
  renderFinish(stories);
  showScreen("finish");
});

socket.on("partner:disconnected", () => {
  disconnectOverlay.classList.remove("hidden");
});

socket.on("error", (msg) => {
  showToast(msg);
});

// --- UTIL ---
function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// Focus name on load
nameInput.focus();
