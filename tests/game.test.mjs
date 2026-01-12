import { describe, expect, it } from 'vitest';
import { evaluateBoard, getAiMove, getBestMove } from '../public/game.mjs';

describe('evaluateBoard', () => {
  it('detects a winner', () => {
    const board = ['X', 'X', 'X', null, null, null, null, null, null];
    const outcome = evaluateBoard(board);

    expect(outcome.winner).toBe('X');
    expect(outcome.isDraw).toBe(false);
  });

  it('detects a draw', () => {
    const board = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
    const outcome = evaluateBoard(board);

    expect(outcome.isDraw).toBe(true);
  });
});

describe('AI moves', () => {
  it('takes a winning move when available', () => {
    const board = ['O', 'O', null, 'X', 'X', null, null, null, null];
    const move = getBestMove(board);

    expect(move).toBe(2);
  });

  it('blocks an immediate loss', () => {
    const board = ['X', 'X', null, null, 'O', null, null, null, null];
    const move = getBestMove(board);

    expect(move).toBe(2);
  });

  it('returns a valid move on easy difficulty', () => {
    const board = ['O', 'O', null, 'X', 'X', null, null, null, null];
    const originalRandom = Math.random;
    Math.random = () => 0.99;

    const move = getAiMove(board, 'easy');

    Math.random = originalRandom;
    expect(move).toBe(2);
  });
});
