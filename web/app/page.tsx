type Experience = {
  arcana: string;
  title: string;
  tagline: string;
  points: string[];
  href?: string;
  size?: string;
  cta: string;
  disabled?: boolean;
};

const experiences: Experience[] = [
  {
    arcana: "II",
    title: "Young Studio · Python",
    tagline: "La versión de referencia. Multiplataforma, madura, fácil de leer y modificar.",
    points: [
      "Corre en Windows, macOS y Linux",
      "Requiere Python 3.10+ (Tkinter incluido)",
      "Ideal si querés leer o tocar el código",
    ],
    href: "/downloads/young-studio-python.zip",
    size: "21 KB",
    cta: "Descargar .zip",
  },
  {
    arcana: "VIII",
    title: "Young Studio · Nativo (C)",
    tagline: "Interfaz Win32 nativa, llamadas a Claude sin intermediarios.",
    points: [
      "Solo Windows 10/11 (64-bit)",
      "Arranque instantáneo, un .exe liviano",
      "El runtime .young todavía se apoya en Python por debajo",
    ],
    href: "/downloads/young-studio-native-win64.zip",
    size: "36 KB",
    cta: "Descargar .zip",
  },
  {
    arcana: "0",
    title: "Young Web",
    tagline: "Un tercer camino: chat con el Oráculo directo en el navegador, sin instalar nada.",
    points: [
      "MyComputer sandboxeado en el navegador (.young)",
      "Host Agent opcional para PC_ACTION en tu máquina real",
      "Mismo protocolo FILE_ACTION que las versiones nativas",
    ],
    href: "/live",
    cta: "Abrir Young Live",
  },
];

const snippet = `ritual integrate(shadow: int, ego: int) -> int {
    CHARIOT IF shadow > ego {
        return shadow;
    } ELSE {
        return ego;
    }
}

ritual main() -> int {
    mut self_state: int = integrate(shadow, consciousness);
    HIEROPHANT print("manifest=" + str(self_state));
    return 0;
}`;

export default function Home() {
  return (
    <div className="flex-1 bg-radial-glow">
      <div className="mx-auto flex max-w-5xl flex-col px-6 py-16 sm:px-8 sm:py-24">
        <header className="flex items-center justify-between">
          <span className="font-[family-name:var(--font-display)] text-sm tracking-[0.3em] text-gold">
            YOUNG
          </span>
          <span className="text-xs tracking-widest text-zinc-500">
            ASSEMBLY · JUNG · TAROT · KABBALAH
          </span>
        </header>

        <section className="mt-20 sm:mt-28">
          <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold leading-tight text-zinc-50 sm:text-6xl">
            Un assembly para
            <br />
            <span className="text-violet">el inconsciente.</span>
          </h1>
          <p className="mt-6 max-w-xl text-balance text-lg leading-8 text-zinc-400">
            Young es un lenguaje ritualizado y determinista: control de flujo
            explícito (<code className="text-zinc-300">CHARIOT IF</code>,{" "}
            <code className="text-zinc-300">STRENGTH WHILE</code>) con nombres
            de variables que codifican intención psicológica —{" "}
            <em className="not-italic text-zinc-300">shadow</em>,{" "}
            <em className="not-italic text-zinc-300">anima</em>,{" "}
            <em className="not-italic text-zinc-300">self</em>.
          </p>
        </section>

        <section className="mt-20">
          <h2 className="font-[family-name:var(--font-display)] text-xl tracking-wide text-zinc-100">
            Elegí tu experiencia
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500">
            No hay una versión "oficial" — cada rama del proyecto explora una
            forma distinta de interactuar con el mismo runtime. Usá la que
            más te sirva.
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {experiences.map((exp) => (
              <div
                key={exp.title}
                className="flex flex-col rounded-lg border border-white/10 bg-white/[0.03] p-5"
              >
                <span className="font-[family-name:var(--font-display)] text-xs text-gold">
                  {exp.arcana}
                </span>
                <h3 className="mt-2 text-base font-medium text-zinc-100">
                  {exp.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {exp.tagline}
                </p>
                <ul className="mt-4 flex-1 space-y-1.5 text-xs text-zinc-500">
                  {exp.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="text-violet">·</span>
                      {point}
                    </li>
                  ))}
                </ul>
                {exp.disabled ? (
                  <span className="mt-5 inline-flex items-center justify-center rounded-md border border-white/10 py-2 text-sm text-zinc-600">
                    {exp.cta}
                  </span>
                ) : (
                  <a
                    href={exp.href}
                    className="mt-5 inline-flex items-center justify-center gap-2 rounded-md bg-zinc-50 py-2 text-sm font-medium text-zinc-950 transition hover:bg-white"
                  >
                    {exp.cta}
                    {exp.size ? (
                      <span className="text-xs text-zinc-500">
                        {exp.size}
                      </span>
                    ) : null}
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20">
          <h2 className="font-[family-name:var(--font-display)] text-xl tracking-wide text-zinc-100">
            Un ritual, en código
          </h2>
          <pre className="mt-6 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-5 font-[family-name:var(--font-geist-mono)] text-sm leading-6 text-zinc-300">
            <code>{snippet}</code>
          </pre>
        </section>

        <footer className="mt-24 flex flex-col gap-1 border-t border-white/10 pt-8 text-xs text-zinc-600">
          <span>Young — proyecto personal en desarrollo activo.</span>
          <span>
            Cada descarga incluye su propio README con requisitos e
            instrucciones de uso.
          </span>
        </footer>
      </div>
    </div>
  );
}
