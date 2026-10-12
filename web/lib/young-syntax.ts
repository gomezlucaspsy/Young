// The Young language as young_runner.py actually parses it — the single
// source the Oracle prompt and the syntax checker below are built from.
// Keep in sync with young_runner.py (tokenize / Parser).

export const YOUNG_SYNTAX_GUIDE = `Young (.young) syntax — follow it EXACTLY; the interpreter rejects anything else.
It is a ritualized, assembly-minded language with C/Rust-like structure. It is NOT Python.

Program  = one or more rituals; "ritual main() -> int { ... }" is required.
           Optional at top: use <python_module> [as alias];
Ritual   = ritual name(a: int, b: int) -> int { statements }
Statements (every simple statement ends with ";"):
  mut x: int = 0;            mutable variable      let y: int = 10;   constant-style variable
  x = x + 1;                 assignment (no +=, no ++)
  CHARIOT IF cond { ... } ELSE { ... }     branch  (no "else if": nest a CHARIOT IF inside the ELSE block)
  STRENGTH WHILE cond { ... }             loop    (no for/foreach; count with a mut index)
  HIEROPHANT print(expr);    output; several values: HIEROPHANT print("label", value);
  return expr;               WORLD;  (halt / exit 0)
  EMPRESS ritual_call(args);  spawn a task, returns a handle;  LOVERS handle;  join it
  cost <= ON { ... }         cost-annotated block
Expressions: integers, "double-quoted strings", + - * / %, == != < > <= >=, && ||, parentheses,
  calls to other rituals, and builtins: str() int() min() max() len() sum() math.*
Comments: # to end of line.
Not supported (syntax error): single quotes, [ ] lists/indexing, ":" blocks / indentation-based code,
  def/for/elif/else if, += -= ++, missing semicolons, missing braces.

Style: name state by psychological intent (shadow, anima, ego, self_state, individuation); keep rituals small
(init / process / integrate / manifest); bounded loops; end with HIEROPHANT print("result=" + str(x));

Example:
\`\`\`
ritual integrate(shadow: int, ego: int) -> int {
    CHARIOT IF shadow > ego {
        return shadow;
    } ELSE {
        return ego;
    }
}

ritual main() -> int {
    mut shadow: int = 7;
    mut acc: int = 0;
    STRENGTH WHILE shadow > 0 {
        acc = acc + shadow;
        shadow = shadow - 1;
    }
    let self_state: int = integrate(acc, 20);
    HIEROPHANT print("result=" + str(self_state));
    return 0;
}
\`\`\``;

// ── Structural checker: a port of young_runner.py's tokenizer + Parser ──────
// Expressions are only bracket-balanced (Python evals them at run time), so
// this catches what the parser would reject, not runtime errors.

const TOKEN_RE =
  /\s+|#.*|<=|>=|==|!=|&&|\|\||->|[{}();,:.]|[+\-*/%<>]=?|=|"[^"\\]*(?:\\.[^"\\]*)*"|\d+|[A-Za-z_][A-Za-z0-9_]*/y;

type Tok = { t: string; pos: number };

export type YoungCheck = { ok: true } | { ok: false; line: number; message: string };

class CheckError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

// A statement keyword inside an expression means the previous line lost its
// ";" — Python's parser would glue both lines together and fail at run time.
const STATEMENT_KEYWORDS = new Set(["let", "mut", "return", "CHARIOT", "STRENGTH", "HIEROPHANT", "WORLD", "EMPRESS", "LOVERS", "ritual"]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let pos = 0;
  while (pos < src.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m || m[0].length === 0) {
      throw new CheckError(`carácter inesperado: ${JSON.stringify(src.slice(pos, pos + 15))}`, pos);
    }
    if (m[0].trim() && !m[0].startsWith("#")) toks.push({ t: m[0], pos });
    pos += m[0].length;
  }
  return toks;
}

function parse(toks: Tok[], srcLen: number) {
  let i = 0;
  const peek = () => toks[i]?.t;
  const here = () => toks[i]?.pos ?? srcLen;
  const pop = (expected?: string) => {
    const tok = toks[i];
    if (!tok) throw new CheckError(expected ? `falta '${expected}' al final` : "el archivo termina antes de tiempo", srcLen);
    if (expected !== undefined && tok.t !== expected) throw new CheckError(`se esperaba '${expected}' y vino '${tok.t}'`, tok.pos);
    i++;
    return tok.t;
  };
  const exprUntil = (stop: string) => {
    const start = here();
    let depth = 0;
    let n = 0;
    for (;;) {
      const t = peek();
      if (t === undefined) throw new CheckError(`expresión sin terminar (falta '${stop}')`, start);
      if (depth === 0 && t === stop) break;
      if (t === "{" || t === "}") throw new CheckError(`falta '${stop}' antes de '${t}'`, here());
      if (n > 0 && STATEMENT_KEYWORDS.has(t)) throw new CheckError(`falta ';' antes de '${t}'`, toks[i - 1].pos);
      if (t === "(") depth++;
      else if (t === ")") depth--;
      if (depth < 0) throw new CheckError("paréntesis de cierre de más", here());
      pop();
      n++;
    }
    if (depth !== 0) throw new CheckError("paréntesis sin cerrar", start);
    return n;
  };
  const block = () => {
    pop("{");
    while (peek() !== "}") {
      if (peek() === undefined) throw new CheckError("falta '}'", srcLen);
      stmt();
    }
    pop("}");
  };
  const stmt = () => {
    const t = peek();
    if (t === "let" || t === "mut") {
      pop();
      pop();
      if (peek() === ":") {
        pop(":");
        pop();
      }
      if (peek() === "=") {
        pop("=");
        exprUntil(";");
      }
      pop(";");
    } else if (t === "if" || t === "CHARIOT") {
      if (pop() === "CHARIOT" && peek() === "IF") pop("IF");
      exprUntil("{");
      block();
      if (peek() === "else" || peek() === "ELSE") {
        pop();
        if (peek() !== "{") throw new CheckError("después de ELSE va un bloque { } (no hay 'else if')", here());
        block();
      }
    } else if (t === "while" || t === "STRENGTH") {
      if (pop() === "STRENGTH" && peek() === "WHILE") pop("WHILE");
      exprUntil("{");
      block();
    } else if (t === "halt" || t === "WORLD") {
      pop();
      pop(";");
    } else if (t === "cost") {
      pop();
      pop("<=");
      pop();
      block();
    } else {
      // return / EMPRESS / LOVERS / HIEROPHANT / assignment / expression
      if (["return", "spawn", "EMPRESS", "join", "LOVERS", "HIEROPHANT"].includes(t ?? "")) pop();
      exprUntil(";");
      pop(";");
    }
  };

  let hasMain = false;
  while (peek() !== undefined) {
    if (peek() === "use") {
      pop();
      pop();
      if (peek() === "as") {
        pop();
        pop();
      }
      pop(";");
      continue;
    }
    if (peek() !== "ritual") throw new CheckError(`se esperaba 'ritual' y vino '${peek()}'`, here());
    pop("ritual");
    if (pop() === "main") hasMain = true;
    pop("(");
    if (peek() !== ")") {
      for (;;) {
        pop();
        if (peek() === ":") {
          pop(":");
          pop();
        }
        if (peek() !== ",") break;
        pop(",");
      }
    }
    pop(")");
    if (peek() === "->") {
      pop("->");
      pop();
    }
    block();
  }
  if (!hasMain) throw new CheckError("falta 'ritual main()'", 0);
}

export function checkYoung(src: string): YoungCheck {
  try {
    parse(tokenize(src), src.length);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof CheckError)) return { ok: false, line: 1, message: String(err) };
    const line = src.slice(0, err.pos).split("\n").length;
    return { ok: false, line, message: err.message };
  }
}
