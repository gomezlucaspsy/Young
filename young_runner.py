import os
import re
import sys
import math
import json
import argparse
import importlib
from dataclasses import dataclass


@dataclass
class ReturnSignal(Exception):
    value: int


def tokenize(src: str):
    token_re = re.compile(
        r'\s+|#.*|<=|>=|==|!=|&&|\|\||->|[{}();,:.]|[+\-*/%<>]=?|=|\"[^\"\\]*(?:\\.[^\"\\]*)*\"|\d+|[A-Za-z_][A-Za-z0-9_]*'
    )
    tokens = []
    pos = 0
    while pos < len(src):
        m = token_re.match(src, pos)
        if not m:
            raise SyntaxError(f"Unexpected character at {pos}: {src[pos:pos+20]}")
        t = m.group(0)
        pos = m.end()
        if t.strip() == "" or t.startswith("#"):
            continue
        tokens.append(t)
    return tokens


class Parser:
    def __init__(self, tokens):
        self.toks = tokens
        self.i = 0

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else None

    def pop(self, expected=None):
        t = self.peek()
        if t is None:
            raise SyntaxError("Unexpected end of input")
        if expected is not None and t != expected:
            raise SyntaxError(f"Expected '{expected}', got '{t}'")
        self.i += 1
        return t

    def parse_program(self):
        imports = []
        rituals = {}
        while self.peek() is not None:
            if self.peek() == "use":
                imports.append(self.parse_use_decl())
                continue
            name, params, body = self.parse_ritual_decl()
            rituals[name] = (params, body)
        if "main" not in rituals:
            raise SyntaxError("Program must define ritual main()")
        return imports, rituals

    def parse_use_decl(self):
        self.pop("use")
        module_name = self.pop()
        alias = module_name
        if self.peek() == "as":
            self.pop("as")
            alias = self.pop()
        self.pop(";")
        return (module_name, alias)

    def parse_ritual_decl(self):
        self.pop("ritual")
        name = self.pop()
        self.pop("(")
        params = []
        if self.peek() != ")":
            while True:
                param_name = self.pop()
                if self.peek() == ":":
                    self.pop(":")
                    self.pop()  # type
                params.append(param_name)
                if self.peek() == ",":
                    self.pop(",")
                    continue
                break
        self.pop(")")
        if self.peek() == "->":
            self.pop("->")
            self.pop()  # return type
        body = self.parse_block()
        return name, params, body

    def parse_block(self):
        self.pop("{")
        stmts = []
        while self.peek() != "}":
            stmts.append(self.parse_stmt())
        self.pop("}")
        return ("block", stmts)

    def parse_stmt(self):
        t = self.peek()
        if t in ("let", "mut"):
            return self.parse_vardecl()
        if t in ("if", "CHARIOT"):
            return self.parse_if()
        if t in ("while", "STRENGTH"):
            return self.parse_while()
        if t == "return":
            self.pop("return")
            expr = self.parse_expr_until(";")
            self.pop(";")
            return ("return", expr)
        if t in ("halt", "WORLD"):
            self.pop()
            self.pop(";")
            return ("halt",)
        if t in ("spawn", "EMPRESS"):
            self.pop()
            expr = self.parse_expr_until(";")
            self.pop(";")
            return ("spawn", expr)
        if t in ("join", "LOVERS"):
            self.pop()
            expr = self.parse_expr_until(";")
            self.pop(";")
            return ("join", expr)
        if t == "HIEROPHANT":
            self.pop("HIEROPHANT")
            expr = self.parse_expr_until(";")
            self.pop(";")
            return ("expr", expr)
        if t == "cost":
            self.pop("cost")
            self.pop("<=")
            self.pop()  # O1/OLOGN/...
            body = self.parse_block()
            return ("cost", body)

        # assignment or expression statement
        if self._looks_like_assignment():
            name = self.pop()
            self.pop("=")
            expr = self.parse_expr_until(";")
            self.pop(";")
            return ("assign", name, expr)

        expr = self.parse_expr_until(";")
        self.pop(";")
        return ("expr", expr)

    def _looks_like_assignment(self):
        if self.i + 1 >= len(self.toks):
            return False
        return re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", self.toks[self.i] or "") and self.toks[self.i + 1] == "="

    def parse_vardecl(self):
        mut = self.pop() == "mut"
        name = self.pop()
        if self.peek() == ":":
            self.pop(":")
            self.pop()  # type
        init = "0"
        if self.peek() == "=":
            self.pop("=")
            init = self.parse_expr_until(";")
        self.pop(";")
        return ("vardecl", mut, name, init)

    def parse_if(self):
        if self.peek() == "CHARIOT":
            self.pop("CHARIOT")
            if self.peek() == "IF":
                self.pop("IF")
        else:
            self.pop("if")
        cond = self.parse_expr_until("{")
        then_block = self.parse_block()
        else_block = None
        if self.peek() in ("else", "ELSE"):
            self.pop()
            else_block = self.parse_block()
        return ("if", cond, then_block, else_block)

    def parse_while(self):
        if self.peek() == "STRENGTH":
            self.pop("STRENGTH")
            if self.peek() == "WHILE":
                self.pop("WHILE")
        else:
            self.pop("while")
        cond = self.parse_expr_until("{")
        body = self.parse_block()
        return ("while", cond, body)

    def parse_expr_until(self, stop_token):
        depth = 0
        parts = []
        while True:
            t = self.peek()
            if t is None:
                raise SyntaxError("Unterminated expression")
            if depth == 0 and t == stop_token:
                break
            if t == "(":
                depth += 1
            elif t == ")":
                depth -= 1
            parts.append(self.pop())

        if parts and parts[0] == "EMPRESS":
            inner = " ".join(parts[1:])
            expr = f"spawn({inner})"
        elif parts and parts[0] == "LOVERS":
            inner = " ".join(parts[1:])
            expr = f"join({inner})"
        elif parts and parts[0] == "HIEROPHANT":
            expr = " ".join(parts[1:])
        else:
            expr = " ".join(parts)

        expr = expr.replace("&&", " and ").replace("||", " or ")
        expr = expr.replace(" . ", ".")
        return expr


class Runtime:
    def __init__(self, imports, rituals):
        self.imports = imports
        self.rituals = rituals
        self.tasks = {}
        self.next_task_id = 1
        self.modules = {}
        self._load_imports()

    def _load_imports(self):
        for module_name, alias in self.imports:
            try:
                self.modules[alias] = importlib.import_module(module_name)
            except Exception as ex:
                raise RuntimeError(f"Failed to import module '{module_name}' as '{alias}': {ex}") from ex

    def _spawn_value(self, value):
        task_id = self.next_task_id
        self.next_task_id += 1
        self.tasks[task_id] = value
        return task_id

    def _join_handle(self, handle):
        handle = int(handle)
        if handle not in self.tasks:
            raise RuntimeError(f"Unknown task handle: {handle}")
        return self.tasks[handle]

    def _call_ritual(self, name, args):
        if name not in self.rituals:
            raise NameError(f"Unknown ritual '{name}'")
        params, body = self.rituals[name]
        if len(args) != len(params):
            raise TypeError(f"Ritual '{name}' expects {len(params)} args, got {len(args)}")
        env = {param: arg for param, arg in zip(params, args)}
        try:
            self.exec_block(body, env)
        except ReturnSignal as r:
            return r.value
        return 0

    def eval_expr(self, expr: str, env: dict):
        safe_globals = {"__builtins__": {}}
        safe_locals = dict(env)
        safe_locals["print"] = print
        safe_locals["len"] = len
        safe_locals["range"] = range
        safe_locals["sum"] = sum
        safe_locals["min"] = min
        safe_locals["max"] = max
        safe_locals["sorted"] = sorted
        safe_locals["str"] = str
        safe_locals["int"] = int
        safe_locals["float"] = float
        safe_locals["bool"] = bool
        safe_locals["math"] = math
        safe_locals["json"] = json
        safe_locals.update(self.modules)
        safe_locals["spawn"] = self._spawn_value
        safe_locals["join"] = self._join_handle
        for ritual_name in self.rituals.keys():
            safe_locals[ritual_name] = lambda *args, n=ritual_name: self._call_ritual(n, list(args))
        return eval(expr, safe_globals, safe_locals)

    def exec_block(self, block, env):
        _, stmts = block
        for stmt in stmts:
            kind = stmt[0]
            if kind == "vardecl":
                _, _mut, name, init = stmt
                env[name] = self.eval_expr(init, env)
            elif kind == "assign":
                _, name, expr = stmt
                if name not in env:
                    raise NameError(f"Variable '{name}' not declared")
                env[name] = self.eval_expr(expr, env)
            elif kind == "expr":
                _, expr = stmt
                self.eval_expr(expr, env)
            elif kind == "if":
                _, cond, then_block, else_block = stmt
                if self.eval_expr(cond, env):
                    self.exec_block(then_block, env)
                elif else_block is not None:
                    self.exec_block(else_block, env)
            elif kind == "while":
                _, cond, body = stmt
                while self.eval_expr(cond, env):
                    self.exec_block(body, env)
            elif kind == "return":
                _, expr = stmt
                raise ReturnSignal(int(self.eval_expr(expr, env)))
            elif kind == "halt":
                raise ReturnSignal(0)
            elif kind == "spawn":
                _, expr = stmt
                self._spawn_value(self.eval_expr(expr, env))
            elif kind == "join":
                _, expr = stmt
                self._join_handle(self.eval_expr(expr, env))
            elif kind == "cost":
                _, body = stmt
                self.exec_block(body, env)
            else:
                raise RuntimeError(f"Unknown statement kind: {kind}")

    def run(self):
        return int(self._call_ritual("main", []))


def _collect_exprs_from_block(block):
    _, stmts = block
    exprs = []
    for stmt in stmts:
        kind = stmt[0]
        if kind in ("vardecl", "assign"):
            exprs.append(stmt[-1])
        elif kind in ("expr", "return", "spawn", "join"):
            exprs.append(stmt[1])
        elif kind in ("if", "while"):
            exprs.append(stmt[1])
            exprs.extend(_collect_exprs_from_block(stmt[2]))
            if kind == "if" and stmt[3] is not None:
                exprs.extend(_collect_exprs_from_block(stmt[3]))
        elif kind == "cost":
            exprs.extend(_collect_exprs_from_block(stmt[1]))
    return exprs


def validate_c_profile(imports, rituals):
    if imports:
        mod_names = ", ".join(mod for mod, _ in imports)
        raise SyntaxError(
            f"C profile does not allow Python module imports. Remove: {mod_names}"
        )

    if "main" not in rituals or len(rituals["main"][0]) != 0:
        raise SyntaxError("C profile requires ritual main() with no parameters")

    unsupported = [
        (r"\bstr\s*\(", "Use numeric-only print values; avoid str(...)."),
        (r"\bfloat\s*\(", "Use integer arithmetic for C profile."),
        (r"\bbool\s*\(", "Use explicit 0/1 values for C profile."),
        (r"\bjson\.", "json module access is not C-transpilable."),
        (r"\bmath\.", "math module access is not C-transpilable."),
        (r"\bspawn\s*\(", "spawn/join are runtime features, not C profile."),
        (r"\bjoin\s*\(", "spawn/join are runtime features, not C profile."),
        (r'"[^"\\]*"\s*\+', "Avoid string concatenation in C profile prints."),
        (r'\+\s*"[^"\\]*"', "Avoid string concatenation in C profile prints."),
    ]

    for ritual_name, (_params, body) in rituals.items():
        for expr in _collect_exprs_from_block(body):
            for pattern, hint in unsupported:
                if re.search(pattern, expr):
                    raise SyntaxError(
                        f"C profile violation in ritual '{ritual_name}': '{expr}'. {hint}"
                    )


class CTranspiler:
    def __init__(self, imports, rituals):
        self.imports = imports
        self.rituals = rituals

    def transpile(self):
        out = []
        out.append("#include <stdio.h>")
        out.append("#include <stdint.h>")
        out.append("")
        out.append("#define YOUNG_PRINT(x) _Generic((x), \\")
        out.append("    int: printf(\"%d\\n\", (x)), \\")
        out.append("    long: printf(\"%ld\\n\", (long)(x)), \\")
        out.append("    double: printf(\"%f\\n\", (double)(x)), \\")
        out.append("    char*: printf(\"%s\\n\", (x)), \\")
        out.append("    const char*: printf(\"%s\\n\", (x)), \\")
        out.append("    default: printf(\"%d\\n\", (int)(x))")
        out.append("")

        # Forward declarations
        for ritual_name, (params, _body) in self.rituals.items():
            out.append(self._function_signature(ritual_name, params) + ";")
        out.append("")

        for ritual_name, (params, body) in self.rituals.items():
            out.append(self._function_signature(ritual_name, params))
            out.append("{")
            out.extend(self._emit_block(body, 1))
            out.append("}")
            out.append("")

        return "\n".join(out).rstrip() + "\n"

    def _function_signature(self, ritual_name, params):
        c_params = ", ".join(f"int {name}" for name in params)
        if not c_params:
            c_params = "void"
        return f"int {ritual_name}({c_params})"

    def _emit_block(self, block, indent):
        _, stmts = block
        lines = []
        for stmt in stmts:
            lines.extend(self._emit_stmt(stmt, indent))
        return lines

    def _emit_stmt(self, stmt, indent):
        kind = stmt[0]
        pre = "    " * indent
        if kind == "vardecl":
            _, _mut, name, init = stmt
            return [f"{pre}int {name} = {self._expr_to_c(init)};"]
        if kind == "assign":
            _, name, expr = stmt
            return [f"{pre}{name} = {self._expr_to_c(expr)};"]
        if kind == "expr":
            _, expr = stmt
            expr = expr.strip()
            if expr.startswith("print(") and expr.endswith(")"):
                inner = expr[len("print("):-1].strip()
                return [f"{pre}YOUNG_PRINT({self._expr_to_c(inner)});"]
            return [f"{pre}(void)({self._expr_to_c(expr)});"]
        if kind == "if":
            _, cond, then_block, else_block = stmt
            lines = [f"{pre}if ({self._expr_to_c(cond)}) {{"]
            lines.extend(self._emit_block(then_block, indent + 1))
            if else_block is None:
                lines.append(f"{pre}}}")
            else:
                lines.append(f"{pre}}} else {{")
                lines.extend(self._emit_block(else_block, indent + 1))
                lines.append(f"{pre}}}")
            return lines
        if kind == "while":
            _, cond, body = stmt
            lines = [f"{pre}while ({self._expr_to_c(cond)}) {{"]
            lines.extend(self._emit_block(body, indent + 1))
            lines.append(f"{pre}}}")
            return lines
        if kind == "return":
            _, expr = stmt
            return [f"{pre}return (int)({self._expr_to_c(expr)});"]
        if kind == "halt":
            return [f"{pre}return 0;"]
        if kind == "spawn":
            _, expr = stmt
            return [f"{pre}/* spawn omitted in C profile */ (void)({self._expr_to_c(expr)});"]
        if kind == "join":
            _, expr = stmt
            return [f"{pre}/* join omitted in C profile */ (void)({self._expr_to_c(expr)});"]
        if kind == "cost":
            _, body = stmt
            lines = [f"{pre}/* cost directive ignored in C output */"]
            lines.extend(self._emit_block(body, indent))
            return lines
        raise RuntimeError(f"Unsupported statement for C transpiler: {kind}")

    def _expr_to_c(self, expr):
        c_expr = expr
        c_expr = re.sub(r"\band\b", "&&", c_expr)
        c_expr = re.sub(r"\bor\b", "||", c_expr)
        c_expr = re.sub(r"\bnot\b", "!", c_expr)
        c_expr = re.sub(r"\bTrue\b", "1", c_expr)
        c_expr = re.sub(r"\bFalse\b", "0", c_expr)
        c_expr = re.sub(r"\bint\s*\(", "(int)(", c_expr)
        c_expr = re.sub(r"\bfloat\s*\(", "(double)(", c_expr)
        return c_expr


def run(src: str) -> int:
    tokens = tokenize(src)
    imports, rituals = Parser(tokens).parse_program()
    return Runtime(imports, rituals).run()


def transpile_to_c(src: str, strict_c_profile=False) -> str:
    tokens = tokenize(src)
    imports, rituals = Parser(tokens).parse_program()
    if strict_c_profile:
        validate_c_profile(imports, rituals)
    return CTranspiler(imports, rituals).transpile()


def _resolve_input_file(argv):
    if len(argv) == 2:
        return argv[1]

    defaults = [
        "main.young",
        "sample_painpoint.young",
        "sample_rituals_tarot.young",
        "sample_tarot.young",
        "sample.young",
    ]
    for candidate in defaults:
        if os.path.exists(candidate):
            return candidate

    return None


def run_repl():
    print("Young REPL mode. Type :q to quit.")
    runtime = Runtime([], {"main": ([], ("block", []))})
    env = {}
    while True:
        try:
            line = input("young> ").strip()
        except EOFError:
            print()
            break

        if not line:
            continue
        if line in (":q", ":quit", "exit"):
            break

        try:
            if line.endswith(";"):
                line = line[:-1].strip()

            if line.startswith("use "):
                m = re.match(r"^use\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$", line)
                if not m:
                    print("Invalid use syntax. Example: use json as js")
                    continue
                module_name = m.group(1)
                alias = m.group(2) or module_name
                runtime.imports.append((module_name, alias))
                runtime._load_imports()
                print(f"imported {module_name} as {alias}")
                continue

            if "=" in line and "==" not in line and not line.startswith("lambda"):
                name, expr = line.split("=", 1)
                name = name.strip()
                expr = expr.strip()
                env[name] = runtime.eval_expr(expr, env)
                print(env[name])
            else:
                value = runtime.eval_expr(line, env)
                if value is not None:
                    print(value)
        except Exception as ex:
            print(f"error: {ex}")


def main():
    arg_parser = argparse.ArgumentParser(description="Young runtime and C transpiler")
    arg_parser.add_argument("input_file", nargs="?", help="Path to .young program")
    arg_parser.add_argument("--emit-c", dest="emit_c", help="Write transpiled C output to this file")
    arg_parser.add_argument(
        "--strict-c-profile",
        action="store_true",
        help="Reject non-C-friendly constructs (recommended for transpilation)",
    )
    args = arg_parser.parse_args()

    input_file = args.input_file if args.input_file else _resolve_input_file(sys.argv)
    if input_file is None:
        run_repl()
        return

    if not os.path.exists(input_file):
        print(f"Input file not found: {input_file}")
        print("Tip: run without args to open REPL, or pass an existing .young file.")
        sys.exit(2)

    with open(input_file, "r", encoding="utf-8") as f:
        src = f.read()

    if args.emit_c:
        c_src = transpile_to_c(src, strict_c_profile=args.strict_c_profile)
        with open(args.emit_c, "w", encoding="utf-8", newline="\n") as f:
            f.write(c_src)
        print(f"Transpiled C written to: {args.emit_c}")

    code = run(src)
    print(f"Young file: {input_file}")
    print(f"Young program exited with code {code}")
    sys.exit(code)


if __name__ == "__main__":
    main()
