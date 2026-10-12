"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type InstallPromptEvent = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Floating install trigger that opens a QR code linking to /live, so Young
 * can be scanned open on a phone and added to its home screen (PWA install —
 * on Android, Chrome packages this as a real installable WebAPK automatically,
 * no separate native build needed).
 */
export default function InstallQR() {
  // /live is a full-screen IDE layout with its own "Instalar" entry in the
  // status bar — it opens this dialog via the young:open-install event instead
  // of the floating button, which would cover the status bar.
  const floating = !usePathname()?.startsWith("/live");
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [pageUrl] = useState(() =>
    typeof window === "undefined" ? "" : `${window.location.origin}/live`,
  );
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as InstallPromptEvent);
    };
    const openDialog = () => setOpen(true);
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("young:open-install", openDialog);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("young:open-install", openDialog);
    };
  }, []);

  useEffect(() => {
    if (!open || !pageUrl) return;
    let cancelled = false;
    import("qrcode")
      .then((QRCode) =>
        QRCode.toDataURL(pageUrl, {
          width: 240,
          margin: 1,
          color: { dark: "#08070c", light: "#ffffff" },
        }),
      )
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, pageUrl]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") setOpen(false);
  };

  return (
    <>
      {floating && <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs font-medium tracking-tight text-zinc-200 shadow-lg backdrop-blur transition-colors hover:bg-black/80"
      >
        {installed ? "Compartir" : "📱 Instalar"}
      </button>}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0c0a12] p-7 text-center shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-[family-name:var(--font-display)] text-base tracking-wide text-gold">
              {installed ? "Compartir Young" : "Instalar Young"}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              {installed
                ? "Escaneá con otro celular para abrir Young Live y agregarlo a su pantalla de inicio."
                : "Escaneá con la cámara de tu celular para abrir Young Live y agregarlo a tu pantalla de inicio — queda como una app más."}
            </p>
            <div className="mx-auto my-5 flex h-[216px] w-[216px] items-center justify-center rounded-2xl bg-white p-3">
              {qrUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrUrl} alt="Código QR para instalar Young" width={200} height={200} />
              ) : (
                <span className="text-xs text-zinc-500">Generando QR…</span>
              )}
            </div>
            <p className="mb-5 break-all text-xs text-zinc-600">{pageUrl}</p>
            {deferredPrompt && (
              <button
                onClick={handleInstall}
                className="mb-2 w-full rounded-md bg-violet px-4 py-3 text-sm font-medium text-white transition hover:brightness-110"
              >
                Instalar en este dispositivo
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="w-full rounded-md border border-white/10 px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-white/5"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
