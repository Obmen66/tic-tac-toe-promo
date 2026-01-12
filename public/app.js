import { evaluateBoard, getAiMove } from './game.mjs';

const cells = Array.from(document.querySelectorAll('[data-cell]'));
const boardEl = document.querySelector('[data-board]');
const statusEl = document.getElementById('status');
const resetButton = document.getElementById('reset');
const difficultySelect = document.getElementById('difficulty');
const starterButtons = Array.from(document.querySelectorAll('[data-starter]'));
const initialStarterButton = starterButtons.find((button) =>
  button.classList.contains('is-active')
);
const initialStarter = initialStarterButton ? initialStarterButton.dataset.starter : 'player';

const modal = document.getElementById('resultModal');
const modalTitle = document.getElementById('modalTitle');
const modalText = document.getElementById('modalText');
const promoWrap = document.getElementById('promoWrap');
const promoCodeEl = document.getElementById('promoCode');
const copyButton = document.getElementById('copyButton');
const copyStatus = document.getElementById('copyStatus');
const promoHint = document.getElementById('promoHint');
const telegramShare = document.getElementById('telegramShare');
const playAgainButton = document.getElementById('playAgain');
const modalCloseButton = document.getElementById('modalClose');
const confettiEl = document.getElementById('confetti');

let board = Array(9).fill(null);
let previousBoard = Array(9).fill(null);
let isLocked = false;
let gameOver = false;
let currentPromoCode = '';
let difficulty = difficultySelect ? difficultySelect.value : 'normal';
let playerStarts = initialStarter !== 'computer';
let computerTimer = null;
let winTimer = null;

const prefersReducedMotion = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

function setStatus(text) {
  statusEl.textContent = text;
}

function renderBoard() {
  cells.forEach((cell, index) => {
    const value = board[index];
    cell.textContent = value || '';
    cell.classList.toggle('cell--filled', Boolean(value));
    cell.classList.toggle('cell--o', value === 'O');
    cell.classList.toggle('cell--x', value === 'X');

    if (value && previousBoard[index] !== value) {
      cell.classList.add('cell--pop');
      setTimeout(() => cell.classList.remove('cell--pop'), 200);
    }
  });

  previousBoard = [...board];
  boardEl.classList.toggle('board--locked', isLocked || gameOver);
}

function clearWinHighlight() {
  cells.forEach((cell) => cell.classList.remove('cell--win'));
}

function highlightWin(combo) {
  combo.forEach((index) => {
    cells[index].classList.add('cell--win');
  });
}

function clearComputerTimer() {
  if (computerTimer) {
    clearTimeout(computerTimer);
    computerTimer = null;
  }
}

function clearWinTimer() {
  if (winTimer) {
    clearTimeout(winTimer);
    winTimer = null;
  }
}

function createEventId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function reportResult(result, eventId) {
  const payload = { result };
  if (eventId) payload.eventId = eventId;

  const response = await fetch('/api/result', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Failed to report result');
  }

  return response.json();
}

function setModalContent(title, text, promoCode = '') {
  modalTitle.textContent = title;
  modalText.textContent = text;
  currentPromoCode = promoCode;

  if (promoCode) {
    promoWrap.hidden = false;
    promoCodeEl.textContent = promoCode;
    copyButton.textContent = 'Копировать';
    if (copyStatus) copyStatus.textContent = '';
    if (promoHint) promoHint.hidden = false;
    if (telegramShare) {
      const shareText = `Мой промокод: ${promoCode}. Вставь промокод на оплате — скидка применится автоматически.`;
      telegramShare.href = `https://t.me/share/url?text=${encodeURIComponent(shareText)}`;
    }
  } else {
    promoWrap.hidden = true;
    promoCodeEl.textContent = '';
    if (copyStatus) copyStatus.textContent = '';
    if (promoHint) promoHint.hidden = true;
    if (telegramShare) telegramShare.href = '#';
  }
}

function openModal() {
  modal.classList.add('modal--open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  modal.classList.remove('modal--open');
  modal.setAttribute('aria-hidden', 'true');
}

function handleCopy() {
  if (!currentPromoCode) return;

  const fallbackCopy = () => {
    const area = document.createElement('textarea');
    area.value = currentPromoCode;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentPromoCode).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }

  const originalText = copyButton.textContent;
  copyButton.textContent = 'Скопировано ✓';
  if (copyStatus) copyStatus.textContent = 'Скопировано ✓';
  setTimeout(() => {
    copyButton.textContent = originalText;
    if (copyStatus) copyStatus.textContent = '';
  }, 1200);
}

function launchConfetti() {
  if (!confettiEl || prefersReducedMotion.matches) return;

  confettiEl.innerHTML = '';
  confettiEl.classList.add('confetti--active');

  const colors = ['#f6c1d1', '#e7c4ea', '#bfe3d1', '#f7d7aa', '#cbb4e6'];
  const count = 18;

  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti__piece';
    const left = Math.random() * 100;
    const size = 6 + Math.random() * 6;
    const drift = Math.floor(Math.random() * 120 - 60);
    const delay = Math.random() * 0.2;
    const duration = 0.9 + Math.random() * 0.6;
    const rotate = Math.floor(Math.random() * 360);
    const color = colors[i % colors.length];

    piece.style.setProperty('--x', `${left}%`);
    piece.style.setProperty('--size', `${size}px`);
    piece.style.setProperty('--drift', `${drift}px`);
    piece.style.setProperty('--delay', `${delay}s`);
    piece.style.setProperty('--duration', `${duration}s`);
    piece.style.setProperty('--rotate', `${rotate}deg`);
    piece.style.setProperty('--color', color);
    confettiEl.appendChild(piece);
  }

  setTimeout(() => {
    confettiEl.classList.remove('confetti--active');
    confettiEl.innerHTML = '';
  }, 1700);
}

async function handleWin() {
  const eventId = createEventId();
  setStatus('Вы победили!');
  setModalContent('Вы победили!', 'Генерируем ваш промокод...', '');
  openModal();

  try {
    const data = await reportResult('win', eventId);
    setModalContent('Вы победили!', 'Ваш промокод на скидку:', data.code || '');
  } catch (error) {
    setModalContent('Вы победили!', 'Не удалось получить промокод. Попробуйте позже.', '');
  }
}

async function handleLoss() {
  const eventId = createEventId();
  setStatus('Сегодня удача на стороне компьютера.');
  setModalContent('Почти получилось', 'В этот раз победил компьютер. Хотите сыграть ещё раз?', '');
  openModal();

  try {
    await reportResult('loss', eventId);
  } catch (error) {
    // Fail silently for the player experience.
  }
}

function handleDraw() {
  setStatus('Ничья.');
  setModalContent('Ничья', 'Сыграем ещё раз?', '');
  openModal();
}

function endGame(outcome) {
  gameOver = true;
  isLocked = true;

  if (outcome.combo) {
    highlightWin(outcome.combo);
  }

  renderBoard();

  if (outcome.isDraw) {
    handleDraw();
    return;
  }

  if (outcome.winner === 'X') {
    const delay = Math.floor(200 + Math.random() * 151);
    clearWinTimer();
    winTimer = setTimeout(() => {
      launchConfetti();
      handleWin();
    }, delay);
  } else {
    handleLoss();
  }
}

function makeComputerMove() {
  const move = getAiMove(board, difficulty);
  if (move !== null) {
    board[move] = 'O';
  }

  renderBoard();
  const computerOutcome = evaluateBoard(board);

  if (computerOutcome) {
    endGame(computerOutcome);
  } else {
    isLocked = false;
    setStatus('Ваш ход');
    renderBoard();
  }
}

function queueComputerMove() {
  clearComputerTimer();
  isLocked = true;
  setStatus('Ход компьютера...');
  renderBoard();

  computerTimer = setTimeout(() => {
    if (!gameOver) {
      makeComputerMove();
    }
  }, 420);
}

function handleCellClick(index) {
  if (gameOver || isLocked || board[index]) return;

  board[index] = 'X';
  renderBoard();

  const outcome = evaluateBoard(board);
  if (outcome) {
    endGame(outcome);
    return;
  }

  queueComputerMove();
}

function updateStarterButtons(selected) {
  starterButtons.forEach((button) => {
    const isActive = button.dataset.starter === selected;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function resetGame() {
  clearComputerTimer();
  clearWinTimer();
  board = Array(9).fill(null);
  previousBoard = Array(9).fill(null);
  gameOver = false;
  isLocked = false;
  currentPromoCode = '';
  promoCodeEl.textContent = '';
  if (confettiEl) {
    confettiEl.classList.remove('confetti--active');
    confettiEl.innerHTML = '';
  }
  clearWinHighlight();
  closeModal();

  if (playerStarts) {
    setStatus('Ваш ход');
    renderBoard();
  } else {
    queueComputerMove();
  }
}

cells.forEach((cell, index) => {
  cell.addEventListener('click', () => handleCellClick(index));
});

if (difficultySelect) {
  difficultySelect.addEventListener('change', (event) => {
    difficulty = event.target.value;
    resetGame();
  });
}

starterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const starter = button.dataset.starter;
    playerStarts = starter !== 'computer';
    updateStarterButtons(starter);
    resetGame();
  });
});

resetButton.addEventListener('click', resetGame);
playAgainButton.addEventListener('click', resetGame);
copyButton.addEventListener('click', handleCopy);
modalCloseButton.addEventListener('click', closeModal);

modal.addEventListener('click', (event) => {
  if (event.target.hasAttribute('data-close')) {
    closeModal();
  }
});

updateStarterButtons(initialStarter);
resetGame();
