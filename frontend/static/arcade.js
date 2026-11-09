import {el} from './core.js';

function gameLayout(root, title, instructions, status, board) {
  const reset = el('button', {type:'button'}, 'Заново');
  root.append(el('div', {class:'game-top'}, el('h2', {}, title), reset), board, status,
    el('p', {class:'game-help'}, instructions));
  return reset;
}

const NEIGHBORS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const CORNERS = new Set([0, 7, 56, 63]);

function captures(board, index, side) {
  if (board[index]) return [];
  const result = [];
  const x = index % 8, y = Math.floor(index / 8);
  for (const [dx,dy] of NEIGHBORS) {
    const line = [];
    let nx = x + dx, ny = y + dy;
    while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
      const target = ny * 8 + nx;
      if (board[target] === side) { result.push(...line); break; }
      if (!board[target]) break;
      line.push(target);
      nx += dx;
      ny += dy;
    }
  }
  return result;
}

function legalMoves(board, side) {
  const moves = new Map();
  for (let index = 0; index < 64; index++) {
    const flipped = captures(board, index, side);
    if (flipped.length) moves.set(index, flipped);
  }
  return moves;
}

export function reversiGame(root) {
  const board = el('div', {class:'reversi-board', 'aria-label':'Поле реверси'});
  const status = el('p', {class:'arcade-status', role:'status'});
  const reset = gameLayout(root, 'Реверси', 'Вы играете акцентными фишками против компьютера. Точками отмечены доступные ходы.', status, board);
  let pieces, humanMoves, last;
  const cells = Array.from({length:64}, (_, index) => {
    const button = el('button', {type:'button', class:'reversi-cell', onclick:() => turn(index)});
    board.append(button);
    return button;
  });
  function apply(index, flipped, side) {
    pieces[index] = side;
    for (const spot of flipped) pieces[spot] = side;
    last = index;
  }
  function render(message = '') {
    const human = pieces.filter(piece => piece === 1).length;
    const computer = pieces.filter(piece => piece === 2).length;
    const end = human > computer ? 'Вы победили' : human < computer ? 'Победил компьютер' : 'Ничья';
    status.textContent = `${humanMoves.size ? message || 'Ваш ход' : end} · Вы ${human} : ${computer} Компьютер`;
    cells.forEach((button, index) => {
      const piece = pieces[index], legal = humanMoves.has(index);
      button.dataset.piece = piece;
      button.classList.toggle('legal', legal);
      button.classList.toggle('last', index === last);
      button.setAttribute('aria-disabled', String(!legal));
      button.tabIndex = legal ? 0 : -1;
      const coordinate = String.fromCharCode(65 + index % 8) + (1 + Math.floor(index / 8));
      button.setAttribute('aria-label', `${coordinate} · ${legal ? 'доступный ход' : piece === 1 ? 'ваша фишка' : piece === 2 ? 'фишка компьютера' : 'пусто'}`);
    });
  }
  function turn(index) {
    const flipped = humanMoves.get(index);
    if (!flipped) return;
    apply(index, flipped, 1);
    let skipped = false;
    for (;;) {
      const choices = legalMoves(pieces, 2);
      if (!choices.size) {
        humanMoves = legalMoves(pieces, 1);
        render(humanMoves.size ? 'Компьютер пропускает ход' : '');
        break;
      }
      let best, points = -Infinity;
      for (const [index, flipped] of choices) {
        const edge = index % 8 === 0 || index % 8 === 7 || index < 8 || index > 55;
        const score = flipped.length + (CORNERS.has(index) ? 40 : edge ? 6 : 0);
        if (score > points) { best = index; points = score; }
      }
      apply(best, choices.get(best), 2);
      humanMoves = legalMoves(pieces, 1);
      if (humanMoves.size) { render(skipped ? 'Ваш прошлый ход был пропущен' : ''); break; }
      skipped = true;
    }
    if (document.activeElement === cells[index]) cells[humanMoves.keys().next().value]?.focus({preventScroll:true});
  }
  reset.onclick = () => {
    pieces = Array(64).fill(0);
    pieces[28] = pieces[35] = 1;
    pieces[27] = pieces[36] = 2;
    last = -1;
    humanMoves = legalMoves(pieces, 1);
    render();
  };
  reset.onclick();
  return () => {};
}

const adjacent = (a, b) => Math.abs(a % 4 - b % 4) + Math.abs(Math.floor(a / 4) - Math.floor(b / 4)) === 1;
const solved = tiles => tiles.every((value, index) => value === (index + 1) % 16);

export function fifteenGame(root) {
  const board = el('div', {class:'fifteen-board', 'aria-label':'Поле пятнашек'});
  const status = el('p', {class:'arcade-status', role:'status'});
  const reset = gameLayout(root, 'Пятнашки', 'Соберите числа по порядку. Нажмите плитку рядом с пустой клеткой или используйте стрелки на поле.', status, board);
  let tiles, gap, steps;
  const cells = Array.from({length:16}, (_, index) => {
    const button = el('button', {type:'button', onclick:() => slide(index)});
    board.append(button);
    return button;
  });
  function swap(index) {
    [tiles[index],tiles[gap]] = [tiles[gap],tiles[index]];
    gap = index;
  }
  function render() {
    const complete = solved(tiles);
    status.textContent = complete ? `Головоломка собрана за ${steps} ходов.` : `Ходы: ${steps}`;
    cells.forEach((cell, index) => {
      cell.textContent = tiles[index] || '';
      cell.classList.toggle('gap', !tiles[index]);
      cell.classList.toggle('movable', !complete && adjacent(index, gap));
      cell.disabled = !tiles[index];
      cell.setAttribute('aria-label', tiles[index] ? `Плитка ${tiles[index]}` : 'Пустая клетка');
    });
  }
  function slide(index) {
    if (!adjacent(index,gap) || solved(tiles)) return;
    const destination = gap;
    swap(index);
    steps++;
    render();
    cells[destination].focus({preventScroll:true});
  }
  board.onkeydown = event => {
    const offset = {ArrowLeft:1, ArrowRight:-1, ArrowUp:4, ArrowDown:-4}[event.key];
    if (offset == null) return;
    event.preventDefault();
    if (gap + offset >= 0 && gap + offset < 16) slide(gap + offset);
  };
  reset.onclick = () => {
    tiles = Array.from({length:16}, (_, index) => (index + 1) % 16);
    gap = 15;
    steps = 0;
    let previous = -1;
    for (let move = 0; move < 100; move++) {
      const choices = [gap - 4, gap + 4, gap - 1, gap + 1].filter(index => index >= 0 && index < 16 && index !== previous && adjacent(index,gap));
      previous = gap;
      swap(choices[Math.floor(Math.random() * choices.length)]);
    }
    if (solved(tiles)) swap(14);
    render();
  };
  reset.onclick();
  return () => {};
}
