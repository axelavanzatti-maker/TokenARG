import { ExternalLink } from "lucide-react";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chains";
import { shortAddress, shortHash } from "@/lib/format";

/** Hash de transacción o dirección, con enlace al explorador de bloques si la red tiene uno. */
export function ChainLink({
  kind,
  value,
  chainId,
  full = false,
  className = "",
}: {
  kind: "tx" | "address";
  value: string;
  /** Red de la transacción o del contrato: define a qué explorador se enlaza. */
  chainId: number | null | undefined;
  full?: boolean;
  className?: string;
}) {
  const label = full ? value : kind === "tx" ? shortHash(value) : shortAddress(value);
  const href = chainId ? (kind === "tx" ? explorerTxUrl(chainId, value) : explorerAddressUrl(chainId, value)) : undefined;
  const text = <span className="font-mono text-[0.8125rem] break-all">{label}</span>;

  if (!href) {
    return (
      <span className={className} title={value}>
        {text}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={value}
      className={`inline-flex items-center gap-1 text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand ${className}`}
    >
      {text}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="sr-only">(abre el explorador de bloques)</span>
    </a>
  );
}
