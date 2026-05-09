const scoreValue = document.getElementById("score-value");
const highScoreValue = document.getElementById("high-score-value");
const lineValue = document.getElementById("line-value");
const actionHint = document.getElementById("action-hint");

const startOverlay = document.getElementById("start-overlay");
const menuOverlay = document.getElementById("menu-overlay");
const lostOverlay = document.getElementById("lost-overlay");
const lostMessage = document.getElementById("lost-message");

const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const menuResumeBtn = document.getElementById("menu-resume-btn");
const menuMainBtn = document.getElementById("menu-main-btn");
const lostMainMenuBtn = document.getElementById("lost-main-menu-btn");
const guestAuthLinks = document.getElementById("guest-auth-links");
const userAuthInfo = document.getElementById("user-auth-info");
const sidebarUsername = document.getElementById("sidebar-username");
const logoutBtn = document.getElementById("logout-btn");
const boardCanvas = document.getElementById("tetris-board");
const ctx = boardCanvas.getContext("2d");
const nextPieceCanvas = document.getElementById("next-piece");
const nextCtx = nextPieceCanvas ? nextPieceCanvas.getContext("2d") : null;
const mobilePauseBtn = document.getElementById("mobile-pause-btn");
const touchLeftBtn = document.getElementById("touch-left");
const touchRotateBtn = document.getElementById("touch-rotate");
const touchRightBtn = document.getElementById("touch-right");
const touchSoftBtn = document.getElementById("touch-soft");
const touchHardBtn = document.getElementById("touch-hard");
const touchMenuBtn = document.getElementById("touch-menu");

const HIGH_SCORE_KEY = "tetris_high_score";

const COLS = 10;
const ROWS = 20;
let blockSize = 30;

const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
  ],
};

const COLORS = {
  I: "#49d9ff",
  O: "#ffd84c",
  T: "#be77ff",
  S: "#5cf3a2",
  Z: "#ff6d88",
  J: "#6795ff",
  L: "#ffaf5c",
  X: "#28355f",
};

const state = {
  started: false,
  paused: false,
  lost: false,
  score: 0,
  lines: 0,
  highScore: Number(localStorage.getItem(HIGH_SCORE_KEY) || 0),
  board: [],
  activePiece: null,
  nextPiece: null,
  lastTime: 0,
  dropCounter: 0,
};

function resizeCanvas() {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const isMobileWidth = viewportWidth <= 860;
  const isShortDesktop = !isMobileWidth && viewportHeight <= 900;
  const boardHeightRatio = isMobileWidth ? 0.56 : isShortDesktop ? 0.5 : 0.64;
  const widthDivisor = isMobileWidth ? 14 : isShortDesktop ? 18 : 15;
  const minBlock = isMobileWidth ? 16 : 14;
  const availableHeight = Math.max(260, Math.floor(viewportHeight * boardHeightRatio));
  const dynamicBlock = Math.max(minBlock, Math.floor(Math.min(availableHeight / ROWS, viewportWidth / widthDivisor)));
  blockSize = dynamicBlock;

  const cssWidth = COLS * blockSize;
  const cssHeight = ROWS * blockSize;
  const dpr = window.devicePixelRatio || 1;

  boardCanvas.style.width = `${cssWidth}px`;
  boardCanvas.style.height = `${cssHeight}px`;
  boardCanvas.width = Math.floor(cssWidth * dpr);
  boardCanvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (nextPieceCanvas && nextCtx) {
    const previewSize = Math.max(56, Math.floor(blockSize * 3.2));
    nextPieceCanvas.style.width = `${previewSize}px`;
    nextPieceCanvas.style.height = `${previewSize}px`;
    nextPieceCanvas.width = Math.floor(previewSize * dpr);
    nextPieceCanvas.height = Math.floor(previewSize * dpr);
    nextCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  drawBoard();
  drawNextPiece();
}

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function syncStats() {
  scoreValue.textContent = String(state.score);
  lineValue.textContent = String(state.lines);
  highScoreValue.textContent = String(state.highScore);
}

function setAuthVisible(loggedIn) {
  guestAuthLinks.classList.toggle("hidden", loggedIn);
  userAuthInfo.classList.toggle("hidden", !loggedIn);
}

async function refreshAuthHighScore(attempt = 0) {
  if (!getAuthToken()) {
    await tryLoginWithRememberedCredentials();
  }

  let token = getAuthToken();
  if (!token) {
    state.highScore = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
    setAuthVisible(false);
    syncStats();
    return;
  }

  setAuthVisible(true);
  const cached = getAuthUser();
  sidebarUsername.textContent = cached?.username || "Player";

  try {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      clearAuthSession();
      if (attempt < 1) {
        await tryLoginWithRememberedCredentials();
        return refreshAuthHighScore(attempt + 1);
      }
      state.highScore = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
      setAuthVisible(false);
      syncStats();
      return;
    }
    const data = await res.json();
    if (data.user) {
      setAuthSession(token, data.user);
      state.highScore = data.user.bestScore;
      sidebarUsername.textContent = data.user.username;
    }
  } catch {
    state.highScore = cached?.bestScore ?? 0;
  }
  syncStats();
}

function setHint(text, type = "") {
  actionHint.textContent = text;
  actionHint.classList.remove("ok", "warn");
  if (type) actionHint.classList.add(type);
}

function showStartScreen() {
  state.started = false;
  state.paused = false;
  state.lost = false;
  startOverlay.classList.remove("hidden");
  menuOverlay.classList.add("hidden");
  lostOverlay.classList.add("hidden");
  drawBoard();
}

function randomPiece() {
  const keys = Object.keys(SHAPES);
  const type = keys[Math.floor(Math.random() * keys.length)];
  const matrix = SHAPES[type].map((row) => [...row]);
  return {
    type,
    matrix,
    x: Math.floor(COLS / 2) - Math.ceil(matrix[0].length / 2),
    y: 0,
  };
}

function rotateMatrix(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const rotated = Array.from({ length: cols }, () => Array(rows).fill(0));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      rotated[x][rows - 1 - y] = matrix[y][x];
    }
  }

  return rotated;
}

function collides(piece, board = state.board) {
  for (let y = 0; y < piece.matrix.length; y += 1) {
    for (let x = 0; x < piece.matrix[y].length; x += 1) {
      if (!piece.matrix[y][x]) continue;
      const nx = piece.x + x;
      const ny = piece.y + y;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function mergePiece() {
  const piece = state.activePiece;
  for (let y = 0; y < piece.matrix.length; y += 1) {
    for (let x = 0; x < piece.matrix[y].length; x += 1) {
      if (piece.matrix[y][x]) {
        const ny = piece.y + y;
        const nx = piece.x + x;
        if (ny >= 0) state.board[ny][nx] = piece.type;
      }
    }
  }
}

function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y -= 1) {
    if (state.board[y].every((cell) => cell !== 0)) {
      state.board.splice(y, 1);
      state.board.unshift(Array(COLS).fill(0));
      cleared += 1;
      y += 1;
    }
  }

  if (cleared > 0) {
    state.lines += cleared;
    const lineScores = [0, 100, 300, 500, 800];
    state.score += lineScores[cleared];
    setHint(`${cleared} line cleared!`, "ok");
  }
}

function dropInterval() {
  // Higher score -> faster falling speed.
  const speedLevel = Math.floor(state.score / 400);
  return Math.max(120, 850 - speedLevel * 45);
}

function spawnPiece() {
  if (!state.nextPiece) {
    state.nextPiece = randomPiece();
  }
  state.activePiece = state.nextPiece;
  state.activePiece.x = Math.floor(COLS / 2) - Math.ceil(state.activePiece.matrix[0].length / 2);
  state.activePiece.y = 0;
  state.nextPiece = randomPiece();
  drawNextPiece();
  if (collides(state.activePiece)) {
    void endGame();
  }
}

function hardDrop() {
  if (!state.activePiece) return;
  while (!collides({ ...state.activePiece, y: state.activePiece.y + 1 })) {
    state.activePiece.y += 1;
    state.score += 2;
  }
  lockAndContinue();
  setHint("Hard drop executed.");
}

function lockAndContinue() {
  mergePiece();
  clearLines();
  spawnPiece();
  syncStats();
}

function moveHorizontal(direction) {
  state.activePiece.x += direction;
  if (collides(state.activePiece)) {
    state.activePiece.x -= direction;
  } else {
    setHint(direction < 0 ? "Block moved left." : "Block moved right.");
  }
}

function softDrop() {
  state.activePiece.y += 1;
  if (collides(state.activePiece)) {
    state.activePiece.y -= 1;
    lockAndContinue();
  } else {
    state.score += 1;
    setHint("Block is falling faster.");
    syncStats();
  }
}

function rotateActivePiece() {
  const prev = state.activePiece.matrix;
  const rotated = rotateMatrix(prev);
  state.activePiece.matrix = rotated;

  // Basic wall-kick check.
  if (collides(state.activePiece)) {
    state.activePiece.x += 1;
    if (collides(state.activePiece)) {
      state.activePiece.x -= 2;
      if (collides(state.activePiece)) {
        state.activePiece.x += 1;
        state.activePiece.matrix = prev;
        return;
      }
    }
  }

  setHint("Rotate command applied.");
}

function drawCell(x, y, color) {
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillRect(x * blockSize, y * blockSize, blockSize, blockSize);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.strokeRect(x * blockSize, y * blockSize, blockSize, blockSize);
}

function drawBoard() {
  ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const cell = state.board[y][x];
      if (cell) {
        drawCell(x, y, COLORS[cell]);
      } else {
        drawCell(x, y, COLORS.X);
      }
    }
  }

  if (!state.activePiece) return;
  for (let y = 0; y < state.activePiece.matrix.length; y += 1) {
    for (let x = 0; x < state.activePiece.matrix[y].length; x += 1) {
      if (state.activePiece.matrix[y][x]) {
        drawCell(state.activePiece.x + x, state.activePiece.y + y, COLORS[state.activePiece.type]);
      }
    }
  }
}

function startGame() {
  state.started = true;
  state.paused = false;
  state.lost = false;
  state.score = 0;
  state.lines = 0;
  state.board = createBoard();
  state.nextPiece = randomPiece();
  state.lastTime = performance.now();
  state.dropCounter = 0;

  startOverlay.classList.add("hidden");
  menuOverlay.classList.add("hidden");
  lostOverlay.classList.add("hidden");

  spawnPiece();
  syncStats();
  drawBoard();
  setHint("Game started. Good luck!", "ok");
}

function drawNextPiece() {
  if (!nextPieceCanvas || !nextCtx) return;
  const size = nextPieceCanvas.clientWidth || 96;
  nextCtx.clearRect(0, 0, size, size);
  nextCtx.fillStyle = "#0b1020";
  nextCtx.fillRect(0, 0, size, size);
  if (!state.nextPiece) return;

  const matrix = state.nextPiece.matrix;
  const cells = Math.max(matrix.length, matrix[0].length);
  const cellSize = Math.floor(size / (cells + 1));
  const offsetX = Math.floor((size - matrix[0].length * cellSize) / 2);
  const offsetY = Math.floor((size - matrix.length * cellSize) / 2);
  const color = COLORS[state.nextPiece.type];

  nextCtx.shadowColor = color;
  nextCtx.shadowBlur = 5;
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[y].length; x += 1) {
      if (!matrix[y][x]) continue;
      nextCtx.fillStyle = color;
      nextCtx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
      nextCtx.shadowBlur = 0;
      nextCtx.strokeStyle = "rgba(0,0,0,0.22)";
      nextCtx.strokeRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
      nextCtx.shadowColor = color;
      nextCtx.shadowBlur = 5;
    }
  }
  nextCtx.shadowBlur = 0;
}

async function endGame() {
  if (!state.started || state.lost) return;

  const prevBest = state.highScore;

  state.lost = true;
  state.started = false;
  menuOverlay.classList.add("hidden");
  lostOverlay.classList.remove("hidden");

  const token = getAuthToken();
  let newBest = prevBest;

  if (token) {
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ score: state.score }),
      });
      if (res.ok) {
        const data = await res.json();
        newBest = data.bestScore;
        state.highScore = newBest;
        const u = getAuthUser();
        if (u) {
          setAuthSession(token, { ...u, bestScore: newBest });
        }
      }
    } catch {
      /* keep prevBest */
    }
  } else if (state.score > prevBest) {
    newBest = state.score;
    state.highScore = newBest;
    localStorage.setItem(HIGH_SCORE_KEY, String(newBest));
  }

  const isNewRecord = state.score > prevBest;

  if (isNewRecord) {
    lostMessage.textContent = `Congrats! New High Score: ${newBest}`;
    setHint(
      token ? "New personal best saved to your account!" : "You reached a new High Score!",
      "ok",
    );
  } else {
    lostMessage.textContent = `Score: ${state.score} | High Score: ${newBest}`;
    setHint(token ? "Game over." : "You lost. Try again.", "warn");
  }

  syncStats();
}

function openMainMenu() {
  if (!state.started || state.lost) return;
  state.paused = true;
  menuOverlay.classList.remove("hidden");
  setHint("Main menu — game paused.", "warn");
}

function closeMainMenu() {
  if (!state.paused) return;
  state.paused = false;
  menuOverlay.classList.add("hidden");
  setHint("Game resumed.", "ok");
}

function toggleMainMenu() {
  if (!state.started || state.lost) return;
  if (state.paused) {
    closeMainMenu();
  } else {
    openMainMenu();
  }
}

function goToMainMenu() {
  showStartScreen();
  setHint("Choose Start Game or Leaderboard.");
}

function update(time = 0) {
  const delta = time - state.lastTime;
  state.lastTime = time;

  if (state.started && !state.paused && !state.lost) {
    state.dropCounter += delta;
    if (state.dropCounter >= dropInterval()) {
      state.dropCounter = 0;
      state.activePiece.y += 1;
      if (collides(state.activePiece)) {
        state.activePiece.y -= 1;
        lockAndContinue();
      }
    }
    drawBoard();
  }

  requestAnimationFrame(update);
}

function registerKeyboard() {
  document.addEventListener("keydown", (event) => {
    const key = event.key;

    if (key === "Escape") {
      event.preventDefault();
      if (state.started && !state.lost) {
        toggleMainMenu();
      }
      return;
    }

    if (key === "p" || key === "P") {
      event.preventDefault();
      toggleMainMenu();
      return;
    }

    if (!state.started || state.paused || state.lost || !state.activePiece) return;

    executeMappedInput(key);
    event.preventDefault();
  });
}

function executeMappedInput(mappedKey) {
  if (!state.started || state.paused || state.lost || !state.activePiece) return;
  switch (mappedKey) {
    case "ArrowUp":
      rotateActivePiece();
      break;
    case "ArrowLeft":
      moveHorizontal(-1);
      break;
    case "ArrowRight":
      moveHorizontal(1);
      break;
    case "ArrowDown":
      softDrop();
      break;
    case " ":
      hardDrop();
      break;
    default:
      return;
  }
  syncStats();
  drawBoard();
}

function bindTouchButton(button, action) {
  if (!button) return;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    action();
  });
}

function registerTouchControls() {
  const touchToKey = {
    left: "ArrowLeft",
    rotate: "ArrowUp",
    right: "ArrowRight",
    soft: "ArrowDown",
    hard: " ",
  };
  bindTouchButton(touchLeftBtn, () => executeMappedInput(touchToKey.left));
  bindTouchButton(touchRotateBtn, () => executeMappedInput(touchToKey.rotate));
  bindTouchButton(touchRightBtn, () => executeMappedInput(touchToKey.right));
  bindTouchButton(touchSoftBtn, () => executeMappedInput(touchToKey.soft));
  bindTouchButton(touchHardBtn, () => executeMappedInput(touchToKey.hard));
  bindTouchButton(touchMenuBtn, toggleMainMenu);

  [touchLeftBtn, touchRotateBtn, touchRightBtn, touchSoftBtn, touchHardBtn, touchMenuBtn].forEach(
    (btn) => {
      if (!btn) return;
      btn.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
    },
  );
}

startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);
menuResumeBtn.addEventListener("click", () => {
  if (!state.started || state.lost || !state.paused) return;
  closeMainMenu();
});
menuMainBtn.addEventListener("click", goToMainMenu);
lostMainMenuBtn.addEventListener("click", goToMainMenu);
logoutBtn.addEventListener("click", () => {
  clearAuthSession();
  clearRememberedCredentials();
  state.highScore = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
  void refreshAuthHighScore();
});

state.board = createBoard();
void refreshAuthHighScore();
resizeCanvas();
drawBoard();
showStartScreen();
registerKeyboard();
registerTouchControls();
window.addEventListener("resize", resizeCanvas);
if (mobilePauseBtn) {
  mobilePauseBtn.addEventListener("click", (event) => {
    event.preventDefault();
    toggleMainMenu();
  });
}
requestAnimationFrame(update);
