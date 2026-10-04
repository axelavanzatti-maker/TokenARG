import type { Network } from "@/generated/prisma/enums";
import { NETWORK_COLOR, NETWORK_LABEL } from "@/lib/chains";

/** Red en la que vive el token: un punto de color (identidad) y el nombre (texto). */
export function NetworkBadge({ network, className = "" }: { network: Network; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-rule bg-card px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink ${className}`}
      title={`El token de este proyecto se emite en ${NETWORK_LABEL[network]}`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: NETWORK_COLOR[network] }} aria-hidden />
      {NETWORK_LABEL[network]}
    </span>
  );
}
