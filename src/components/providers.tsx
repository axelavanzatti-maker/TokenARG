"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, type State } from "wagmi";
import { getConfig } from "@/lib/web3Config";

export function Providers({ children, initialState }: { children: ReactNode; initialState?: State }) {
  // Una config y un QueryClient por solicitud (en el servidor) y por pestaña (en el navegador).
  const [config] = useState(() => getConfig());
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } }),
  );
  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
