"use client";

import { useState } from "react";
import { useIsClient } from "@/lib/vfs-store";
import Icon from "./Icon";
import type { AgentStatus } from "./types";

type Props = { agentId: string; agent: AgentStatus | null; onToast: (text: string, ok?: boolean) => void };

const CAPABILITIES = ["Ver espacio en disco y sistema", "Ver procesos abiertos", "Abrir la carpeta de Young", "Correr un ritual .young"];

export default function ConnectPanel({ agentId, agent, onToast }: Props) {
  const isClient = useIsClient();
  const detected = isClient && !/Windows/i.test(navigator.userAgent) ? "unix" : "windows";
  const [osOverride, setOsOverride] = useState<"windows" | "unix" | null>(null);
  const os = osOverride ?? detected;
  const online = agent?.status === "online";
  const origin = isClient ? window.location.origin : "";
  const manual = `python young_host_agent.py --id ${agentId} --url ${origin}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center px-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Conectar mi PC</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-xs leading-5">
        <div
          className={`flex items-center gap-3 rounded-md border p-3 ${
            online ? "border-emerald-900/60 bg-emerald-950/30" : "border-white/10 bg-white/[0.02]"
          }`}
          role="status"
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-emerald-400" : "animate-pulse bg-zinc-600"}`} />
          <div>
            <p className={online ? "text-emerald-200" : "text-zinc-300"}>
              {online ? `Conectada${agent?.label ? `: ${agent.label}` : ""}` : "Sin conectar"}
            </p>
            <p className="text-zinc-500">{online ? "El Oráculo ya puede actuar en esta PC." : "Esto se actualiza solo cuando conectes."}</p>
          </div>
        </div>

        {!online && (
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet text-[11px] font-semibold text-white">1</span>
              <div className="flex-1 space-y-2">
                <p className="text-zinc-200">Descargá el conector</p>
                <a
                  href={agentId ? `/api/agent/connector?agentId=${encodeURIComponent(agentId)}&os=${os}` : undefined}
                  download
                  className="flex w-full items-center justify-center gap-2 rounded bg-violet px-3 py-2 font-medium text-white hover:brightness-110"
                >
                  <Icon name="download" size={14} />
                  {os === "windows" ? "Descargar para Windows" : "Descargar para macOS / Linux"}
                </a>
                <button
                  onClick={() => setOsOverride(os === "windows" ? "unix" : "windows")}
                  className="text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                >
                  {os === "windows" ? "¿Usás macOS o Linux?" : "¿Usás Windows?"}
                </button>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-zinc-300">2</span>
              <div className="space-y-1">
                <p className="text-zinc-200">Abrilo con doble clic</p>
                <p className="text-zinc-500">
                  {os === "windows"
                    ? 'Si Windows avisa, tocá "Más información" → "Ejecutar de todas formas". Dejá la ventana abierta.'
                    : "Dejá la ventana abierta. Si no abre, corré: sh conectar-young.command"}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-zinc-300">3</span>
              <p className="text-zinc-200">Listo — este panel se pone en verde.</p>
            </li>
          </ol>
        )}

        <div className="space-y-1.5">
          <p className="text-zinc-400">El Oráculo solo puede hacer estas cuatro cosas en tu PC:</p>
          <ul className="space-y-1 text-zinc-500">
            {CAPABILITIES.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <Icon name="check" size={12} className="text-emerald-500/80" /> {c}
              </li>
            ))}
          </ul>
          <p className="text-zinc-600">Nada más: no hay forma de que ejecute comandos arbitrarios. Para desconectar, cerrá la ventana del conector.</p>
        </div>

        <details className="group text-zinc-500">
          <summary className="cursor-pointer select-none hover:text-zinc-300">Avanzado</summary>
          <div className="mt-2 space-y-2">
            <p>Si ya tenés la carpeta de Young con Python:</p>
            <div className="flex items-start gap-2 rounded bg-black/40 p-2">
              <code className="flex-1 break-all font-mono text-[11px] text-zinc-300">{manual}</code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(manual).then(
                    () => onToast("Comando copiado"),
                    () => onToast("No se pudo copiar", false),
                  );
                }}
                aria-label="Copiar comando"
                className="rounded p-1 hover:bg-white/10 hover:text-zinc-200"
              >
                <Icon name="copy" size={13} />
              </button>
            </div>
            <p>
              ID de este navegador: <code className="text-zinc-300">{agentId || "…"}</code>
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
