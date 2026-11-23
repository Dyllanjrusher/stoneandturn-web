// Pure game rules. A future server can validate the same ordered move log.
const directions = [[1,0], [0,1], [-1,1], [-1,0], [0,-1], [1,-1]];
export const BONUS = 0.5;
export const other = color => color === 'black' ? 'white' : 'black';

export function makeBoard(side) {
  if (![4, 5, 6].includes(side)) throw Error('Unknown board size');
  const limit = side - 1;
  const cells = [];
  const index = new Map();
  for (let r = -limit; r <= limit; r++) {
    let col = 1;
    for (let q = Math.max(-limit, -r-limit); q <= Math.min(limit, -r+limit); q++) {
      index.set(q + ',' + r, cells.length);
      cells.push({ q, r, name: String.fromCharCode(65+r+limit) + col++ });
    }
  }
  return cells.map(cell => ({ ...cell, neighbors: directions
    .map(([dq, dr]) => index.get((cell.q+dq) + ',' + (cell.r+dr)))
    .filter(i => i !== undefined) }));
}

export function newGame(side = 5) {
  const cells = makeBoard(side);
  const stones = Array(cells.length).fill(null);
  return { side, cells, stones, turn: 'black', captures: { black: 0, white: 0 }, moves: [], seen: new Set([key(stones)]), ended: false };
}
function key(stones) {
  return stones.map(c => c ? c[0] : '.').join('');
}

function region(cells, stones, start) {
  const members = new Set([start]);
  const border = new Set();
  for (const i of members) {
    for (const n of cells[i].neighbors) {
      if (stones[n] === stones[start]) members.add(n);
      else border.add(stones[n]);
    }
  }
  return { members, border };
}

export function play(game, action) {
  if (game.ended) throw Error('This game has ended.');
  const color = game.turn;
  const turn = other(color);
  if (action?.type === 'pass') {
    return { ...game, turn, moves: [...game.moves, { type: 'pass', color }], ended: game.moves.at(-1)?.type === 'pass' };
  }
  const i = action?.cell;
  if (action?.type !== 'place' || !Number.isInteger(i) || !game.cells[i]) throw Error('Choose a cell on the board.');
  if (game.stones[i]) throw Error('That hex is occupied.');
  const stones = [...game.stones];
  stones[i] = color;
  let taken = 0;
  for (const n of game.cells[i].neighbors) {
    if (stones[n] !== turn) continue;
    const group = region(game.cells, stones, n);
    if (group.border.has(null)) continue;
    for (const member of group.members) stones[member] = null;
    taken += group.members.size;
  }
  if (!region(game.cells, stones, i).border.has(null)) throw Error('That group would have no liberties.');
  const position = key(stones);
  if (game.seen.has(position)) throw Error('That move would repeat an earlier board.');
  return { ...game, stones, turn, seen: new Set([...game.seen, position]),
    captures: { ...game.captures, [color]: game.captures[color] + taken },
    moves: [...game.moves, { type: 'place', cell: i, color, taken }] };
}

export function score(game) {
  const points = { black: 0, white: BONUS };
  const counted = new Set();
  const ownership = game.stones.slice();
  game.stones.forEach((color, i) => {
    if (color) { points[color]++; return; }
    if (counted.has(i)) return;
    const { members, border } = region(game.cells, game.stones, i);
    const owner = border.size === 1 ? [...border][0] : null;
    for (const n of members) { counted.add(n); ownership[n] = owner; }
    if (owner) points[owner] += members.size;
  });
  return { points, ownership };
}
export function replay(side, moves) {
  return moves.reduce(play, newGame(side));
}
