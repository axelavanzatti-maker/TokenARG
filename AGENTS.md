<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TokenARG: guía para agentes de código

Marketplace de activos reales tokenizados (Argentina) sobre Polygon y Ethereum, con mercado secundario P2P y pagos en varias monedas. Antes de cambiar algo, leé el README.

## Mapa

- `blockchain/`: workspace de Hardhat 3 con su propio `package.json`. Usa viem y `node:test`, y es ESM. Los contratos están en `contracts/` y los tests en `test/`. Antes de escribir tests, leé las guías de agentes que trae Hardhat en `node_modules/hardhat/skills/`.
- `src/server/`: código que corre solo en el servidor (Prisma, sesiones, KYC, agente on-chain, indexador). No lo importes desde componentes cliente.
- `src/hooks/useAssetInvestment.ts`: lógica Web3 de la ronda (lecturas, approve + buy, pagar con otra moneda vía PaymentRouter, cobro de rentas, reembolso, finalize).
- `src/hooks/useTokenMarket.ts` y `src/lib/market.ts`: mercado P2P (libro de órdenes, tomar, publicar y retirar). Las cuentas en bigint replican las de `P2PMarket.sol`: si cambia el contrato, cambian acá.
- `src/lib/chains.ts`: redes por modo (`NEXT_PUBLIC_NETWORK_MODE`). Todo lo on-chain lleva su `chainId`; no asumas una sola red.
- `src/lib/contracts/abis.ts` es un archivo **generado**. Si cambiás un contrato: `npm run abis`.
- `data/projects.json` es la fuente única de los proyectos de demo (con su red): lo usan el seed, el deploy y la simulación.
- `.github/workflows/`: `ci.yml` corre todo lo de "Verificación"; `deploy-testnet.yml` despliega en Amoy y Sepolia con los secrets del repo. Nunca pongas claves en el código ni en el `.env` versionado.

## Reglas

- La blockchain es la fuente de verdad. La base es un índice: nunca registres montos que mande el cliente, solo eventos leídos de un recibo (ver `src/server/indexer.ts`).
- Ningún dato personal va on-chain. El registro guarda solo billetera y vencimiento.
- La configuración de wagmi se crea con `getConfig()` por solicitud. No vuelvas a una instancia global: en SSR mezcla el estado de distintos visitantes.
- No llames a `Date.now()` en el render de componentes cliente (lo marca el linter de React y desincroniza la hidratación). Calculalo en un `queryFn`, en el servidor o con datos on-chain.
- Las fechas se formatean siempre en hora argentina (`formatDate` en `src/lib/format.ts`).
- Los textos de la interfaz van en español rioplatense (voseo) y en tono llano. Los errores dicen qué pasó y cómo seguir.

## Verificación

```bash
npm run typecheck && npm run lint && npm run build
npm run contracts:test
npm run smoke        # con la app corriendo, `npm run chain:node` y `npm run demo:local` hecho
npm run test:e2e     # ídem; requiere `npx playwright install chromium`
```

Si cambia `prisma/schema.prisma`: `npm run db:migrate` y versioná la migración.
