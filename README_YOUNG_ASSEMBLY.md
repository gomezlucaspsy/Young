# Young Assembly Architecture Tutorial

A practical guide to writing `.young` programs with assembly-inspired structure, tarot symbolism, and Carl Gustav Jung concepts.

## 1. Mental Model

Think of Young as a ritualized runtime with:

- `ritual` functions as your instruction blocks.
- explicit control flow (`CHARIOT IF`, `STRENGTH WHILE`) like branch and loop opcodes.
- symbolic variable naming (shadow, anima, self, individuation) to encode psychological intent.

Use the language as both:

- a deterministic execution model.
- a semantic layer for meaning and architecture.

## 2. Core Syntax You Will Use Most

### Function Units

```young
ritual main() -> int {
    return 0;
}
```

### Variables

```young
mut counter: int = 0;
let limit: int = 10;
```

### Branching

```young
CHARIOT IF shadow > consciousness {
    HIEROPHANT print("shadow dominates");
} ELSE {
    HIEROPHANT print("ego holds line");
}
```

### Looping

```young
STRENGTH WHILE counter < limit {
    counter = counter + 1;
}
```

### Tracing / Output

```young
HIEROPHANT print("result=" + str(counter));
```

## 3. Assembly-Style Architecture Pattern

A useful pattern is to split your program into 4 symbolic layers.

1. `init` layer: setup and state loading.
2. `process` layer: iterative transforms.
3. `integration` layer: reconcile conflicting states.
4. `manifest` layer: output and return.

Example skeleton:

```young
ritual init(seed: int) -> int {
    return seed;
}

ritual process(value: int) -> int {
    mut i: int = 0;
    mut acc: int = value;
    STRENGTH WHILE i < value {
        acc = acc + i;
        i = i + 1;
    }
    return acc;
}

ritual integrate(shadow: int, ego: int) -> int {
    CHARIOT IF shadow > ego {
        return shadow;
    } ELSE {
        return ego;
    }
}

ritual manifest(total: int) -> int {
    HIEROPHANT print("manifest=" + str(total));
    return 0;
}

ritual main() -> int {
    mut consciousness: int = init(3);
    mut shadow: int = process(4);
    mut self_state: int = integrate(shadow, consciousness);
    return manifest(self_state);
}
```

## 4. Jung + Tarot Mapping Strategy

Use naming as architecture, not decoration.

- `shadow`: suppressed or risky branch state.
- `anima` / `animus`: relational or balancing transform.
- `self`: integrated final state.
- `individuation`: convergence loop toward stable output.

Tarot arcana can drive branch logic.

- `THE HERMIT`: introspection path (analysis-heavy branch).
- `THE CHARIOT`: assertive execution path (forward action).
- `WHEEL OF FORTUNE`: stochastic-seeming cycle represented as deterministic phase transitions.
- `JUDGEMENT`: validation and final reconciliation.

## 5. Cost-Efficient Prompting for Code Generation

When asking Claude to generate `.young` code:

- Request one complete file first.
- Limit explanation to 4 bullets.
- Ask for deterministic runtime and bounded loops.
- Keep constraints explicit (e.g. O(n), max rituals, no recursion).

Prompt template:

```text
Generate one complete .young file.
Goal: [your runtime goal]
Arcana focus: [e.g. X - WHEEL OF FORTUNE]
Constraints: deterministic, O(n), max 4 rituals
Use: ritual main(), CHARIOT IF or STRENGTH WHILE, HIEROPHANT print
Then add exactly 4 short bullets explaining the architecture.
```

## 6. Tutorial Walkthrough (Hands-On)

### Step 1: Generate a scaffold from GUI

In Young Studio:

1. Set Goal, Arcana, Complexity, Constraints in Young Composer.
2. Click `Insert .young Scaffold`.
3. Open the generated file (for example `sample_painpoint.young`).

### Step 2: Refactor scaffold into layers

- Rename generic rituals (`integrate_shadow`, `archetype_loop`) into architectural roles (`init`, `process`, `integrate`, `manifest`).
- Keep `main()` as orchestration only.

### Step 3: Add symbolic trace output

Add 3-5 `HIEROPHANT print(...)` lines so runtime behavior is inspectable.

### Step 4: Run and verify

- Run from GUI using `Run Young`.
- Ensure deterministic outputs across repeated runs.
- Confirm complexity constraints by inspecting loop bounds.

## 7. Recommended Conventions

- Keep rituals small and single-purpose.
- Keep names psychologically meaningful and operationally clear.
- Avoid hidden side effects across rituals.
- Always print a final `result=` trace for debugging.
- Prefer bounded `STRENGTH WHILE` loops.

## 8. Common Pitfalls

- Over-poetic names with no execution meaning.
- Monolithic `main()` containing all logic.
- Missing trace output when debugging control flow.
- Unbounded loops or unclear stop conditions.

## 9. Next Evolution Path

After basic architecture works:

1. Add a validation ritual (`judgement_gate`) that checks invariants.
2. Add a transformation ritual (`anima_bridge`) for data normalization.
3. Build a mini standard pattern library across multiple `.young` files.

## 10. C / Assembly Transpile Profile

Young now supports C emission through `young_runner.py` so you can keep a symbolic authoring layer while targeting a lower-level execution model.

Run transpile:

```powershell
python young_runner.py sample_cosmic_physics.young --strict-c-profile --emit-c native/generated_young.c
```

Then compile generated C (example with MSVC toolchain through CMake shell):

```powershell
cl /std:c11 /O2 native/generated_young.c
```

### C Profile Rules (Recommended)

- Keep `ritual main()` with no parameters.
- Prefer integer arithmetic (`int`) for deterministic behavior.
- Avoid Python-only helpers like `str(...)`, `json.*`, `math.*`, `spawn/join`.
- Avoid string concatenation in prints; print numeric values directly.
- Keep loops bounded and explicit (`STRENGTH WHILE` with clear stop conditions).

This profile keeps `.young` close to C semantics and easier to map to assembly mental models.

---

If you want, the next step can be a second document with reusable "ritual blueprints" (state machine, reducer loop, parser pipeline, and evaluator loop) written directly in `.young`.
