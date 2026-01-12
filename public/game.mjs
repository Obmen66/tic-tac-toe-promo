const winningCombos = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const difficultySettings = {
  easy: {
    blunderRate: 0.25,
    maxDepth: null,
  },
  normal: {
    blunderRate: 0,
    maxDepth: 3,
  },
  hard: {
    blunderRate: 0,
    maxDepth: null,
  },
};

function evaluateBoard(currentBoard) {
  for (const combo of winningCombos) {
    const [a, b, c] = combo;
    if (currentBoard[a] && currentBoard[a] === currentBoard[b] && currentBoard[a] === currentBoard[c]) {
      return { winner: currentBoard[a], combo, isDraw: false };
    }
  }

  if (currentBoard.every(Boolean)) {
    return { winner: null, combo: null, isDraw: true };
  }

  return null;
}

function scoreBoard(currentBoard) {
  let score = 0;

  for (const combo of winningCombos) {
    const values = combo.map((index) => currentBoard[index]);
    const oCount = values.filter((value) => value === 'O').length;
    const xCount = values.filter((value) => value === 'X').length;

    if (oCount > 0 && xCount > 0) continue;

    if (oCount === 2 && xCount === 0) score += 3;
    if (oCount === 1 && xCount === 0) score += 1;
    if (xCount === 2 && oCount === 0) score -= 3;
    if (xCount === 1 && oCount === 0) score -= 1;
  }

  return score;
}

function minimax(currentBoard, depth, isMaximizing, maxDepth) {
  const outcome = evaluateBoard(currentBoard);
  if (outcome) {
    if (outcome.isDraw) return 0;
    return outcome.winner === 'O' ? 10 - depth : depth - 10;
  }

  if (Number.isFinite(maxDepth) && depth >= maxDepth) {
    return scoreBoard(currentBoard);
  }

  if (isMaximizing) {
    let bestScore = -Infinity;
    currentBoard.forEach((value, index) => {
      if (!value) {
        currentBoard[index] = 'O';
        const score = minimax(currentBoard, depth + 1, false, maxDepth);
        currentBoard[index] = null;
        bestScore = Math.max(bestScore, score);
      }
    });
    return bestScore;
  }

  let bestScore = Infinity;
  currentBoard.forEach((value, index) => {
    if (!value) {
      currentBoard[index] = 'X';
      const score = minimax(currentBoard, depth + 1, true, maxDepth);
      currentBoard[index] = null;
      bestScore = Math.min(bestScore, score);
    }
  });
  return bestScore;
}

function getBestMove(currentBoard, maxDepth = null) {
  let bestScore = -Infinity;
  let move = null;

  currentBoard.forEach((value, index) => {
    if (!value) {
      currentBoard[index] = 'O';
      const score = minimax(currentBoard, 0, false, maxDepth);
      currentBoard[index] = null;

      if (score > bestScore) {
        bestScore = score;
        move = index;
      }
    }
  });

  return move;
}

function getRandomMove(currentBoard) {
  const available = currentBoard
    .map((value, index) => (value ? null : index))
    .filter((value) => value !== null);

  if (!available.length) return null;

  const choice = Math.floor(Math.random() * available.length);
  return available[choice];
}

function getAiMove(currentBoard, difficulty = 'normal') {
  const settings = difficultySettings[difficulty] || difficultySettings.normal;

  if (difficulty === 'easy' && Math.random() < settings.blunderRate) {
    return getRandomMove(currentBoard);
  }

  return getBestMove(currentBoard, settings.maxDepth);
}

export { evaluateBoard, getAiMove, getBestMove, minimax, winningCombos };
