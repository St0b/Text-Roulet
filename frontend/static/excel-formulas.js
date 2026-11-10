export const MAX_ROW = 1048576, MAX_COLUMN = 16384;

export function parseAddress(value) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/i.exec(value ?? '');
  if (!match) return null;
  const column = [...match[1].toUpperCase()].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  return column <= MAX_COLUMN && row <= MAX_ROW ? {row, column} : null;
}

const names = new Map([
  ['SUM', 'SUM'], ['СУММ', 'SUM'], ['AVERAGE', 'AVERAGE'], ['СРЗНАЧ', 'AVERAGE'],
  ['MIN', 'MIN'], ['МИН', 'MIN'], ['MAX', 'MAX'], ['МАКС', 'MAX'],
  ['COUNT', 'COUNT'], ['СЧЁТ', 'COUNT'], ['СЧЕТ', 'COUNT'],
]);
const precedence = {'+':1, '-':1, '*':2, '/':2, '^':3};
const numberPattern = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const signedNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAX_TOKENS = 512, MAX_DEPTH = 48, MAX_RANGE = 12000, MAX_STEPS = 90000;

class FormulaIssue extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const invalid = () => new FormulaIssue('syntax', 'Проверьте запись формулы.');
const unsupported = (message = 'GreenOS пока не вычисляет такое выражение.') => new FormulaIssue('unsupported', message);
const limit = () => new FormulaIssue('limit', 'Формула или её диапазон слишком велики для расчёта в GreenOS.');
const excelError = (code, message = code) => new FormulaIssue(code, message);

function tokensOf(formula) {
  const tokens = [];
  let rest = formula.trim();
  if (rest.startsWith('=')) rest = rest.slice(1).trimStart();
  if (rest.length > 8192) throw limit();
  while (rest) {
    if (tokens.length >= MAX_TOKENS) throw limit();
    const number = numberPattern.exec(rest)?.[0];
    const name = /^\$?[\p{L}_][\p{L}0-9_.]*(?:\$[0-9]+)?/u.exec(rest)?.[0];
    const string = /^"(?:[^"]|"")*"/.exec(rest)?.[0];
    if (number) tokens.push({type:'number', text:number});
    else if (name) tokens.push({type:'name', text:name});
    else if (string) tokens.push({type:'string', text:string});
    else if (rest[0] === '"') throw invalid();
    else if ('+-*/^%():,;'.includes(rest[0])) tokens.push({type:'symbol', text:rest[0]});
    else throw unsupported('Поддерживаются арифметика и ссылки A1 внутри выбранного листа.');
    rest = rest.slice(tokens.at(-1).text.length).trimStart();
  }
  return tokens;
}

export function parseFormula(formula) {
  const tokens = tokensOf(formula);
  let index = 0;
  const take = symbol => {
    if (tokens[index]?.text !== symbol) return false;
    index++;
    return true;
  };
  function expression(minimum, depth) {
    if (depth > MAX_DEPTH) throw limit();
    let left;
    if (take('(')) {
      left = expression(0, depth + 1);
      if (!take(')')) throw invalid();
    } else if (['+', '-'].includes(tokens[index]?.text)) {
      left = {kind:'unary', operator:tokens[index++].text, value:expression(5, depth + 1)};
    } else {
      const token = tokens[index++];
      if (token?.type === 'number') left = {kind:'literal', value:Number(token.text)};
      else if (token?.type === 'string') left = {kind:'literal', value:token.text.slice(1, -1).replaceAll('""', '"')};
      else if (token?.type === 'name') {
        token.text = token.text.toUpperCase();
        if (take('(')) {
          const name = names.get(token.text);
          if (!name) throw unsupported(`Функция ${token.text} пока недоступна в GreenOS.`);
          token.text = name;
          const args = [];
          if (!take(')')) {
            for (;;) {
              args.push(expression(0, depth + 1));
              if (take(')')) break;
              if (take(',')) continue;
              if (!take(';')) throw invalid();
              tokens[index - 1].text = ',';
            }
          }
          left = {kind:'function', name, args};
        } else if (token.text === 'TRUE' || token.text === 'FALSE') {
          left = {kind:'literal', value:token.text === 'TRUE'};
        } else {
          const start = parseAddress(token.text);
          if (!start) throw unsupported(`Ссылка ${token.text} недоступна для расчёта в GreenOS.`);
          if (take(':')) {
            const next = tokens[index++];
            const end = parseAddress(next?.text);
            if (!end) throw invalid();
            next.text = next.text.toUpperCase();
            left = {kind:'range', start, end};
          } else left = {kind:'reference', ...start};
        }
      } else throw invalid();
    }
    while (index < tokens.length) {
      const operator = tokens[index].text;
      if (operator === '%' && minimum <= 4) {
        index++;
        left = {kind:'unary', operator, value:left};
        continue;
      }
      const priority = precedence[operator];
      if (!priority || priority < minimum) break;
      index++;
      left = {kind:'binary', operator, left, right:expression(priority + 1, depth + 1)};
    }
    return left;
  }
  const tree = expression(0, 0);
  if (index !== tokens.length) throw invalid();
  return {tree, source:tokens.map(token => token.text).join('')};
}

function finite(value) {
  if (!Number.isFinite(value)) throw excelError('#NUM!', 'Результат вне числового диапазона Excel.');
  return value;
}

function numberValue(value) {
  if (value == null) return 0;
  if (typeof value === 'number' || typeof value === 'boolean') return finite(Number(value));
  if (typeof value === 'string' && signedNumber.test(value.trim())) return finite(Number(value));
  throw excelError('#VALUE!', 'Операции нужно число.');
}

function evaluate(node, get, spend) {
  spend();
  if (node.kind === 'literal') return typeof node.value === 'number' ? finite(node.value) : node.value;
  if (node.kind === 'reference') return get(node.row, node.column);
  if (node.kind === 'range') throw unsupported('Диапазон используйте как аргумент функции, например SUM(A1:A5).');
  if (node.kind === 'unary') {
    const value = numberValue(evaluate(node.value, get, spend));
    return node.operator === '%' ? value / 100 : node.operator === '-' ? -value : value;
  }
  if (node.kind === 'binary') {
    const left = numberValue(evaluate(node.left, get, spend));
    const right = numberValue(evaluate(node.right, get, spend));
    if (node.operator === '+') return finite(left + right);
    if (node.operator === '-') return finite(left - right);
    if (node.operator === '*') return finite(left * right);
    if (node.operator === '^') {
      if (!left && right === 0) throw excelError('#NUM!');
      if (!left && right < 0) throw excelError('#DIV/0!', 'Деление на ноль.');
      return finite(left ** right);
    }
    if (!right) throw excelError('#DIV/0!', 'Деление на ноль.');
    return finite(left / right);
  }
  const numbers = [];
  function reference(row, column) {
    try { return get(row, column); }
    catch (issue) {
      if (node.name === 'COUNT' && issue instanceof FormulaIssue && issue.code.startsWith('#')) return null;
      throw issue;
    }
  }
  for (const arg of node.args) {
    if (arg.kind === 'range') {
      const rowStart = Math.min(arg.start.row, arg.end.row), rowEnd = Math.max(arg.start.row, arg.end.row);
      const colStart = Math.min(arg.start.column, arg.end.column), colEnd = Math.max(arg.start.column, arg.end.column);
      const area = (rowEnd - rowStart + 1) * (colEnd - colStart + 1);
      if (area > MAX_RANGE) throw limit();
      spend(area);
      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
          const value = reference(row, col);
          if (typeof value === 'number') numbers.push(value);
        }
      }
    } else {
      const value = arg.kind === 'reference' ? reference(arg.row, arg.column) : evaluate(arg, get, spend);
      if (typeof value === 'number') numbers.push(value);
      else if (arg.kind === 'literal' && value != null) {
        if (node.name === 'COUNT' && typeof value === 'string' && !signedNumber.test(value.trim())) continue;
        numbers.push(numberValue(value));
      }
    }
  }
  if (node.name === 'COUNT') return numbers.length;
  if (node.name === 'MIN') return numbers.length ? numbers.reduce((minimum, value) => Math.min(minimum, value)) : 0;
  if (node.name === 'MAX') return numbers.length ? numbers.reduce((maximum, value) => Math.max(maximum, value)) : 0;
  const sum = finite(numbers.reduce((total, value) => total + value, 0));
  if (node.name === 'SUM') return sum;
  if (!numbers.length) throw excelError('#DIV/0!', 'В диапазоне нет чисел для среднего значения.');
  return finite(sum / numbers.length);
}

export function sheetCalculator(readCell) {
  const cache = new Map(), active = new Set();
  let steps = 0;
  const spend = (count = 1) => {
    steps += count;
    if (steps > MAX_STEPS) throw limit();
  };
  function get(row, column) {
    const key = row * MAX_COLUMN + column;
    const saved = cache.get(key);
    if (saved) {
      if (saved.issue) throw saved.issue;
      return saved.value;
    }
    if (active.has(key)) throw new FormulaIssue('cycle', 'Циклическая ссылка.');
    if (active.size >= MAX_DEPTH) throw limit();
    const cell = readCell(row, column);
    active.add(key);
    try {
      if (cell.issue === 'unsupported') throw unsupported();
      if (cell.issue) throw excelError(cell.issue);
      const value = cell.formula == null ? cell.value : evaluate(parseFormula(cell.formula).tree, get, spend) ?? 0;
      cache.set(key, {value});
      return value;
    } catch (issue) {
      if (!(issue instanceof FormulaIssue)) throw issue;
      cache.set(key, {issue});
      throw issue;
    } finally { active.delete(key); }
  }
  return (row, column) => {
    try { return {value:get(row, column)}; }
    catch (issue) {
      if (!(issue instanceof FormulaIssue)) throw issue;
      return {issue};
    }
  };
}
