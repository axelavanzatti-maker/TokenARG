"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { useMounted } from "@/hooks/useMounted";

/**
 * Compartir un enlace por WhatsApp, X, LinkedIn o Telegram, copiarlo o usar el menú del
 * teléfono. `url` es absoluta; si es relativa, se completa con el sitio actual.
 */
export function ShareButtons({ url, text, label = "Compartir" }: { url: string; text: string; label?: string }) {
  const mounted = useMounted();
  const [copied, setCopied] = useState(false);
  const full = mounted && url.startsWith("/") ? `${window.location.origin}${url}` : url;
  const encodedUrl = encodeURIComponent(full);
  const encodedText = encodeURIComponent(text);
  const canNativeShare = mounted && typeof navigator.share === "function";

  const targets = [
    { name: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${text} ${full}`)}` },
    { name: "X", href: `https://x.com/intent/post?text=${encodedText}&url=${encodedUrl}` },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
    { name: "Telegram", href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}` },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  const button =
    "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-rule-strong bg-card px-3 py-2 text-sm font-semibold text-ink hover:border-ink/40";

  return (
    <div>
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {canNativeShare && (
          <button type="button" className={button} onClick={() => navigator.share({ title: "TokenARG", text, url: full }).catch(() => {})}>
            <Share2 className="h-4 w-4" aria-hidden /> Compartir
          </button>
        )}
        {targets.map((t) => (
          <a key={t.name} href={t.href} target="_blank" rel="noopener noreferrer" className={button}>
            {t.name}
          </a>
        ))}
        <button type="button" className={button} onClick={copy} aria-live="polite">
          {copied ? <Check className="h-4 w-4 text-yield" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Enlace copiado" : "Copiar enlace"}
        </button>
      </div>
    </div>
  );
}
