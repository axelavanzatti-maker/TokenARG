"use client";

import { Download, ExternalLink, FileText, Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { getAddress } from "viem";
import { useReadContract } from "wagmi";
import type { DocumentType } from "@/generated/prisma/enums";
import { assetTokenAbi } from "@/lib/contracts/abis";
import { shortHash } from "@/lib/format";
import type { ProjectDocumentView } from "@/lib/types";

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  CONTRATO_FIDEICOMISO: "Contrato de fideicomiso",
  TASACION: "Tasación",
  PLAN_DE_NEGOCIOS: "Plan de negocios",
  ESTADOS_CONTABLES: "Estados contables",
  INFORME_AVANCE: "Informe de avance",
  OTRO: "Documento",
};

type CheckState = "checking" | "match" | "mismatch" | "error";

function formatSize(bytes: number | null) {
  if (!bytes) return null;
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function sha256Hex(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Documentos del proyecto con visor de PDF embebido. El contrato de fideicomiso se puede
 * verificar contra el hash SHA-256 anclado en el token: el navegador descarga el archivo,
 * calcula su hash y lo compara con el que devuelve legalDocumentHash() en la blockchain.
 */
export function DocumentViewer({
  documents,
  tokenAddress,
  tokenSymbol,
  chainId,
  deployed,
}: {
  documents: ProjectDocumentView[];
  tokenAddress: string | null;
  tokenSymbol: string;
  /** Red del token, donde está anclado el hash del contrato de fideicomiso. */
  chainId: number | null;
  deployed: boolean;
}) {
  const [selectedId, setSelectedId] = useState(documents[0]?.id);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const selected = documents.find((d) => d.id === selectedId) ?? documents[0];

  const anchored = useReadContract({
    address: tokenAddress ? getAddress(tokenAddress) : undefined,
    abi: assetTokenAbi,
    functionName: "legalDocumentHash",
    chainId: chainId ?? undefined,
    query: { enabled: deployed && Boolean(tokenAddress) && chainId !== null },
  });

  if (!selected) {
    return <p className="text-sm text-ink-muted">El fiduciario todavía no publicó documentos para este proyecto.</p>;
  }

  const isTrustDeed = selected.type === "CONTRATO_FIDEICOMISO";
  const anchoredHex = anchored.data ? anchored.data.slice(2).toLowerCase() : null;
  const expected = isTrustDeed && anchoredHex ? anchoredHex : selected.sha256.toLowerCase();
  const check = checks[selected.id];

  async function verify(doc: ProjectDocumentView) {
    setChecks((c) => ({ ...c, [doc.id]: "checking" }));
    try {
      const actual = await sha256Hex(doc.url);
      setChecks((c) => ({ ...c, [doc.id]: actual === expected ? "match" : "mismatch" }));
    } catch {
      setChecks((c) => ({ ...c, [doc.id]: "error" }));
    }
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card">
      <div role="tablist" aria-label="Documentos del proyecto" className="flex gap-1 overflow-x-auto border-b border-rule px-2 pt-2">
        {documents.map((doc) => {
          const active = doc.id === selected.id;
          return (
            <button
              key={doc.id}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls="visor-documento"
              onClick={() => setSelectedId(doc.id)}
              className={`flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-3 py-2.5 text-left text-sm ${
                active ? "border-brand font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              <FileText className="h-4 w-4 shrink-0" aria-hidden />
              <span>{doc.title}</span>
              {formatSize(doc.sizeBytes) && <span className="text-xs font-normal text-ink-faint">PDF, {formatSize(doc.sizeBytes)}</span>}
            </button>
          );
        })}
      </div>

      <div id="visor-documento" role="tabpanel" className="bg-paper">
        <iframe
          key={selected.id}
          src={`${selected.url}#view=FitH`}
          title={`${selected.title} (PDF)`}
          className="hidden h-[560px] w-full border-0 sm:block"
          loading="lazy"
        />
        <div className="flex items-center gap-3 px-4 py-6 sm:hidden">
          <FileText className="h-8 w-8 text-ink-faint" aria-hidden />
          <p className="text-sm text-ink-muted">En el celular, el PDF se abre en una pestaña nueva.</p>
        </div>
      </div>

      <div className="space-y-3 border-t border-rule px-4 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={selected.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-rule px-3 py-1.5 font-medium text-ink hover:border-rule-strong"
          >
            <ExternalLink className="h-4 w-4" aria-hidden /> Abrir
          </a>
          <a
            href={selected.url}
            download
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-rule px-3 py-1.5 font-medium text-ink hover:border-rule-strong"
          >
            <Download className="h-4 w-4" aria-hidden /> Descargar
          </a>
          <button
            type="button"
            onClick={() => verify(selected)}
            disabled={check === "checking" || (isTrustDeed && deployed && anchored.isLoading)}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-rule px-3 py-1.5 font-medium text-ink hover:border-rule-strong disabled:opacity-60"
          >
            {check === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden />
            )}
            Verificar integridad
          </button>
        </div>

        <p className="text-ink-muted">
          {isTrustDeed && anchoredHex ? (
            <>
              Hash SHA-256 registrado en el token {tokenSymbol}:{" "}
              <span className="font-mono text-[0.8125rem] text-ink" title={anchoredHex}>
                {shortHash(anchoredHex, 10)}
              </span>
            </>
          ) : (
            <>
              Hash SHA-256 publicado:{" "}
              <span className="font-mono text-[0.8125rem] text-ink" title={selected.sha256}>
                {shortHash(selected.sha256, 10)}
              </span>
            </>
          )}
        </p>

        {check === "match" && (
          <p role="status" className="flex items-start gap-2 text-yield">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {isTrustDeed && anchoredHex
              ? `El archivo es idéntico al que el fiduciario registró en el token ${tokenSymbol}.`
              : "El archivo coincide con el hash publicado."}
          </p>
        )}
        {check === "mismatch" && (
          <p role="alert" className="flex items-start gap-2 text-danger">
            <ShieldX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            El archivo NO coincide con el hash registrado. No inviertas basándote en este documento y avisale al fiduciario.
          </p>
        )}
        {check === "error" && (
          <p role="alert" className="text-danger">No pudimos descargar el archivo para verificarlo. Probá de nuevo.</p>
        )}
      </div>
    </div>
  );
}
