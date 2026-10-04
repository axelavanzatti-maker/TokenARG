import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { APP_CHAINS, publicRpcUrl } from "@/lib/chains";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * Configuración de wagmi con las dos redes de la app (Polygon y Ethereum del modo activo). Las
 * lecturas van por el RPC de cada red, así que los datos se ven aunque la billetera esté en
 * otra; para firmar se le pide cambiar a la red del proyecto.
 * Las billeteras de navegador se detectan solas (EIP-6963); WalletConnect se habilita con
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID para billeteras móviles.
 *
 * Es una función y no una constante a propósito: la config guarda el estado de la conexión,
 * y en el servidor un módulo es compartido por todas las solicitudes. Con una instancia
 * global, la billetera de un visitante terminaba renderizada en la página de otro.
 * Cada render del servidor (y cada pestaña) crea la suya.
 */
export function getConfig() {
  return createConfig({
    chains: APP_CHAINS,
    connectors: [
      injected(),
      ...(walletConnectProjectId
        ? [
            walletConnect({
              projectId: walletConnectProjectId,
              metadata: {
                name: "TokenARG",
                description: "Inversiones en activos reales argentinos",
                url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
                icons: [],
              },
            }),
          ]
        : []),
    ],
    transports: {
      [APP_CHAINS[0].id]: http(publicRpcUrl(APP_CHAINS[0])),
      [APP_CHAINS[1].id]: http(publicRpcUrl(APP_CHAINS[1])),
    },
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
  });
}

declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof getConfig>;
  }
}
