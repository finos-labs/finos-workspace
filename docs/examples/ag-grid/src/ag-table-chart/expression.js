/*
 * OpenBB's sparkline `customFormatter` is a JavaScript function in a string, such as
 *   "(params) => ({ fill: params.yValue >= 0 ? '#22c55e' : '#ef4444' })".
 * The frame's policy has no 'unsafe-eval', and a backend's string should not run as code, so
 * this parses the subset formatters use and evaluates it over the params object only:
 * literals, member access, ! - + * / %, comparisons, && || ??, ?: and Math functions.
 */

const MATH = { abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, sign: Math.sign };
const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);
const PUNCTUATION = ["===", "!==", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", "(", ")", "{", "}", "[", "]", ",", ".", ";"];
const MAX_SOURCE = 2000;

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      tokens.push({ kind: "num", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\" && j + 1 < source.length) { text += source[j + 1]; j += 2; continue; }
        if (ch === "`" && source[j] === "$" && source[j + 1] === "{") throw new SyntaxError("template expressions are not supported");
        text += source[j++];
      }
      if (j >= source.length) throw new SyntaxError("unterminated string");
      tokens.push({ kind: "str", value: text });
      i = j + 1;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    if (ident) {
      tokens.push({ kind: "id", value: ident[0] });
      i += ident[0].length;
      continue;
    }
    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (!punct) throw new SyntaxError(`unexpected character ${ch}`);
    tokens.push({ kind: "p", value: punct });
    i += punct.length;
  }
  return tokens;
}

function parser(tokens) {
  let pos = 0;
  const peek = (value) => tokens[pos] && tokens[pos].kind === "p" && tokens[pos].value === value;
  const take = (value) => { if (peek(value)) { pos++; return true; } return false; };
  const expect = (value) => { if (!take(value)) throw new SyntaxError(`expected ${value}`); };
  const identifier = () => {
    const token = tokens[pos];
    if (!token || token.kind !== "id") throw new SyntaxError("expected a name");
    pos++;
    return token.value;
  };

  function binary(next, operators) {
    return () => {
      let left = next();
      for (;;) {
        const op = operators.find((o) => peek(o));
        if (!op) return left;
        pos++;
        left = { type: "bin", op, left, right: next() };
      }
    };
  }

  function primary() {
    const token = tokens[pos];
    if (!token) throw new SyntaxError("unexpected end");
    if (token.kind === "num" || token.kind === "str") { pos++; return { type: "lit", value: token.value }; }
    if (token.kind === "id") {
      pos++;
      if (token.value === "true") return { type: "lit", value: true };
      if (token.value === "false") return { type: "lit", value: false };
      if (token.value === "null") return { type: "lit", value: null };
      if (token.value === "undefined") return { type: "lit", value: undefined };
      return { type: "name", name: token.value };
    }
    if (take("(")) { const inner = expression(); expect(")"); return inner; }
    if (take("{")) {
      const entries = [];
      while (!take("}")) {
        const key = tokens[pos];
        if (!key || (key.kind !== "id" && key.kind !== "str")) throw new SyntaxError("expected a key");
        pos++;
        const value = take(":") ? expression() : { type: "name", name: key.value };
        entries.push([String(key.value), value]);
        if (!take(",")) { expect("}"); break; }
      }
      return { type: "obj", entries };
    }
    throw new SyntaxError(`unexpected ${token.value}`);
  }

  function postfix() {
    let node = primary();
    for (;;) {
      if (take(".")) node = { type: "get", object: node, key: { type: "lit", value: identifier() } };
      else if (take("[")) { const key = expression(); expect("]"); node = { type: "get", object: node, key }; }
      else if (take("(")) {
        const args = [];
        while (!take(")")) {
          args.push(expression());
          if (!take(",")) { expect(")"); break; }
        }
        node = { type: "call", callee: node, args };
      } else return node;
    }
  }

  function unary() {
    if (take("!")) return { type: "not", arg: unary() };
    if (take("-")) return { type: "neg", arg: unary() };
    if (take("+")) return { type: "pos", arg: unary() };
    return postfix();
  }

  const multiplicative = binary(unary, ["*", "/", "%"]);
  const additive = binary(multiplicative, ["+", "-"]);
  const relational = binary(additive, ["<=", ">=", "<", ">"]);
  const equality = binary(relational, ["===", "!==", "==", "!="]);
  const and = binary(equality, ["&&"]);
  const or = binary(and, ["||", "??"]);

  function expression() {
    const test = or();
    if (!take("?")) return test;
    const consequent = expression();
    expect(":");
    return { type: "cond", test, consequent, alternate: expression() };
  }

  /* (params) => expr | params => expr | (params) => { return expr; } | function (params) { return expr; } */
  function program() {
    let param;
    if (tokens[pos]?.kind === "id" && tokens[pos].value === "function") {
      pos++;
      if (tokens[pos]?.kind === "id") pos++;
      expect("(");
      param = identifier();
      expect(")");
      return { param, body: block() };
    }
    if (take("(")) { param = identifier(); expect(")"); } else param = identifier();
    expect("=>");
    if (peek("{") && !looksLikeObject()) return { param, body: block() };
    return { param, body: expression() };
  }

  function looksLikeObject() {
    const next = tokens[pos + 1];
    return next && !(next.kind === "id" && next.value === "return");
  }

  function block() {
    expect("{");
    const name = identifier();
    if (name !== "return") throw new SyntaxError("expected return");
    const body = expression();
    take(";");
    expect("}");
    return body;
  }

  const result = program();
  take(";");
  if (pos !== tokens.length) throw new SyntaxError("unexpected trailing input");
  return result;
}

function evaluate(node, scope) {
  switch (node.type) {
    case "lit": return node.value;
    case "name":
      if (node.name === scope.param) return scope.params;
      if (node.name === "Math") return MATH;
      return undefined;
    case "get": {
      const object = evaluate(node.object, scope);
      const key = String(evaluate(node.key, scope));
      if (object === null || object === undefined || BLOCKED.has(key)) return undefined;
      if (object === MATH) return Object.hasOwn(MATH, key) ? MATH[key] : undefined;
      if (typeof object === "string") return key === "length" ? object.length : undefined;
      return Object.hasOwn(object, key) ? object[key] : undefined;
    }
    case "call": {
      const fn = evaluate(node.callee, scope);
      if (!Object.values(MATH).includes(fn)) throw new TypeError("only Math functions can be called");
      return fn(...node.args.map((arg) => evaluate(arg, scope)));
    }
    case "obj": return Object.fromEntries(node.entries.map(([key, value]) => [key, evaluate(value, scope)]));
    case "not": return !evaluate(node.arg, scope);
    case "neg": return -evaluate(node.arg, scope);
    case "pos": return +evaluate(node.arg, scope);
    case "cond": return evaluate(node.test, scope) ? evaluate(node.consequent, scope) : evaluate(node.alternate, scope);
    case "bin": {
      if (node.op === "&&") return evaluate(node.left, scope) && evaluate(node.right, scope);
      if (node.op === "||") return evaluate(node.left, scope) || evaluate(node.right, scope);
      if (node.op === "??") return evaluate(node.left, scope) ?? evaluate(node.right, scope);
      const a = evaluate(node.left, scope);
      const b = evaluate(node.right, scope);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
        case "===": return a === b;
        case "!==": return a !== b;
        // eslint-disable-next-line eqeqeq
        case "==": return a == b;
        // eslint-disable-next-line eqeqeq
        case "!=": return a != b;
      }
    }
  }
  throw new TypeError(`cannot evaluate ${node.type}`);
}

/** Compiles a formatter string to a function of one params object, or throws a SyntaxError. */
export function compileFormatter(source) {
  if (typeof source !== "string" || source.length > MAX_SOURCE) throw new SyntaxError("a formatter is a string of at most 2000 characters");
  const { param, body } = parser(tokenize(source));
  return (params) => {
    const result = evaluate(body, { param, params });
    return result && typeof result === "object" ? result : {};
  };
}
