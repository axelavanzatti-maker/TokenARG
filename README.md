# TokenARG

TokenARG es un sitio web para cargar, mostrar, adquirir y comercializar tokens RWA (activos reales tokenizados) en Argentina. Cada token es una cuotaparte de un fideicomiso que financia inmuebles, campañas agrícolas, deuda PyME o empresas.

- Los tokens se emiten en **Polygon** o en **Ethereum**, según el proyecto.
- El propio contrato exige que cada billetera tenga la identidad verificada (KYC).
- Se paga con USDC directo, o con USDT, ETH, POL o WBTC, que se convierten a USDC en la misma transacción.
- Hay un **mercado secundario P2P** con 1 % de comisión por operación: 0,5 % paga quien compra y 0,5 % quien vende.

> **Estado:** es un MVP funcional para hacer demos en dos redes locales o en testnet (Polygon Amoy + Ethereum Sepolia). Los proyectos, documentos y montos son ficticios. No es una oferta pública de valores ni asesoramiento legal. Antes de operar con dinero real hacen falta una auditoría de los contratos y el encuadre regulatorio que se resume [más abajo](#marco-regulatorio-argentino).

## Qué incluye

| Capa | Contenido |
|---|---|
| **Contratos** (`blockchain/`) | `IdentityRegistry`: lista blanca KYC con vencimiento. `AssetToken`: ERC-20 que verifica el KYC en cada movimiento, reparte rentas en USDC y guarda el hash del contrato fiduciario. `TokenOffering`: venta primaria en USDC con fondos en garantía, mínimo, cupo y reembolsos. `P2PMarket`: mercado secundario con órdenes de precio fijo y comisión por parte. `PaymentRouter` + adaptadores: pagar con otras monedas (Uniswap V3 en mainnet, precios fijos de prueba en testnet). Hardhat 3 + OpenZeppelin 5.6. |
| **App** (`src/`) | Next.js 16 con:<br>• marketplace con filtros por categoría, estado y red<br>• ficha con métricas, documentos verificables y panel de inversión con selector "Pagar con"<br>• mercado secundario: gráfico de precio, libro de órdenes, publicar y retirar órdenes<br>• página `/mercado` con todos los tokens<br>• alta KYC con firma SIWE, válida en las dos redes<br>• cartera con valor de mercado, rentas y reembolsos |
| **Backend** (`src/app/api`, `src/server`) | Sesiones SIWE. KYC con proveedor intercambiable (simulado o webhook firmado). Una billetera agente habilita a cada inversor en el registro de cada red. Indexador de compras, rentas y operaciones del mercado, por red. |
| **Datos** (`prisma/`) | PostgreSQL con Prisma 7: proyectos, documentos, legajos KYC, altas por red, contratos por red, inversiones, distribuciones y operaciones del mercado. |
| **CI/CD** (`.github/workflows/`) | `ci.yml`: contratos, tipos, lint, build y la demo completa con e2e en cada push. `deploy-testnet.yml`: despliega en Amoy y Sepolia con un clic y guarda las direcciones en el repo. |

## Redes

La app opera en un **modo** (`NEXT_PUBLIC_NETWORK_MODE`), y cada modo usa un par de redes:

| Modo | Polygon | Ethereum | Moneda de pago |
|---|---|---|---|
| `local` | Hardhat, chainId 31337, `:8545` | Hardhat, chainId 31338, `:8546` | MockUSDC con canilla |
| `testnet` | Amoy (80002) | Sepolia (11155111) | MockUSDC con canilla |
| `mainnet` | Polygon PoS (137) | Ethereum (1) | USDC nativo de Circle |

Cada proyecto declara su red en `data/projects.json` (`"network": "polygon"` o `"ethereum"`). Un solo login y una sola verificación sirven para las dos redes: al aprobarse el KYC, el backend habilita la billetera en el `IdentityRegistry` de cada una. Si una red falla, el usuario la habilita después desde `/kyc` (botón "Habilitar en …").

**Solana** queda para una segunda fase: el diseño está en [Solana (fase 2)](#solana-fase-2).

## Mercado secundario P2P

Funciona como los anuncios P2P de un exchange, pero dentro de los contratos:

1. Quien quiere vender (o comprar) publica una **orden con precio fijo** en USDC por token.
2. Otro inversor verificado la **toma**, entera o en parte (cada toma parcial vale al menos USD 1).
3. El contrato intercambia token ↔ USDC **en la misma transacción** y cobra la comisión.

Detalles:

- **No es custodial.** Publicar no inmoviliza fondos: el anunciante autoriza al mercado (`approve`) y la orden muestra cuánto está respaldado hoy (`fillable`).
- **Comisión.** El 1 % se reparte en 0,5 % para cada parte (`MARKET_BUYER_FEE_BPS=50`, `MARKET_SELLER_FEE_BPS=50`) y va en USDC a `FEE_RECIPIENT_ADDRESS`. La administración la cambia con `setFees`, con un tope de 2 % por parte fijado en el contrato. Publicar y retirar órdenes no tiene comisión.
- **Reglas del token.** El `AssetToken` sigue mandando: las dos partes tienen que tener el KYC vigente y el fiduciario tiene que haber habilitado las transferencias (`setTransfersEnabled`). El mercado solo opera tokens listados (`setListed`) y se puede pausar.
- **Rentas.** Las ya devengadas quedan para quien vendió. Las que se depositen después de la operación son para quien compró.
- **Precio y gráfico.** Cada `OrderFilled` se indexa. La ficha muestra el último precio, la variación a 24 h y 7 días, el volumen y un gráfico de cierres diarios con volumen y tabla de datos. El libro de órdenes se lee directo de la blockchain.

## Pagar con otras monedas

`PaymentRouter.buyWithAsset(oferta, moneda, montoUSDC, máximo, vencimiento)` recibe ETH/POL (nativa), WBTC, USDT o WETH, la convierte a exactamente `montoUSDC` y compra a nombre del inversor (`TokenOffering.buyFor`). El fideicomiso siempre recibe USDC.

- **Cotización y tolerancia.** La interfaz cotiza con `quote()` y autoriza como máximo la cotización + 1 %. Si el precio se mueve más, la transacción revierte y no se cobra nada. Lo que sobra vuelve a la billetera en la misma transacción.
- **Conversión.** En mainnet se hace con Uniswap V3 (`UniswapV3Adapter`, direcciones en `blockchain/config/mainnet.json`). En local y testnet, `MockSwapAdapter` usa precios fijos de prueba: POL 0,25, ETH/WETH 3.000, WBTC 100.000 y USDT 1.
- **Monedas de prueba.** En testnet, WBTC, USDT y WETH son contratos de prueba con canilla. El panel ofrece cargarlos.
- **BTC.** Bitcoin nativo no corre en estas redes: se usa WBTC, que es BTC representado en Ethereum o Polygon.

## Arquitectura

```
                      ┌────────────────────────────┐
  Inversor ──────────▶│ Next.js (páginas + wagmi)  │──── firma ────▶ Billetera (MetaMask, Rabby…)
                      └──────────┬─────────────────┘                     │
                      lecturas   │ /api            comprar · pagar con ETH/WBTC · órdenes P2P
                        RPC      ▼                                       ▼
┌────────────────┐    ┌────────────────────────────┐  AGENT_ROLE   ┌────────────────────────────┐
│ Proveedor KYC  │───▶│ API (route handlers)       │──────────────▶│ Polygon        │ Ethereum  │
│ (webhook HMAC) │    │ SIWE · KYC · indexador     │◀── eventos ───│ IdentityRegistry (c/u)     │
└────────────────┘    └──────────┬─────────────────┘               │ AssetToken · TokenOffering │
                                 │ Prisma                          │ P2PMarket · PaymentRouter  │
                                 ▼                                 │ USDC                       │
                      ┌────────────────────────────┐               └────────────────────────────┘
                      │ PostgreSQL: catálogo,      │
                      │ legajos KYC, índice        │
                      └────────────────────────────┘
```

La blockchain es la fuente de verdad de tenencias, aportes, rentas y operaciones. La base guarda tres cosas:

- el catálogo comercial;
- los legajos KYC, con los datos personales, que nunca van on-chain;
- un índice de eventos por red (`chainId + txHash + logIndex`) para listar y graficar rápido.

El índice se puede reconstruir en cualquier momento con `npm run chain:sync`.

## Puesta en marcha local

Requisitos:

- Node.js 22.12 o superior
- Docker, o un PostgreSQL 16 propio
- MetaMask o Rabby en el navegador

```bash
npm install            # app + cliente de Prisma
npm run setup          # workspace de contratos (blockchain/)
npm run setup:env      # crea .env con secretos aleatorios
npm run db:up          # PostgreSQL en Docker
npm run db:migrate     # crea las tablas
npm run db:seed        # carga los 6 proyectos de ejemplo
```

En otra terminal, levantá los dos nodos locales y dejalos corriendo:

```bash
npm run chain:node     # Polygon local en :8545 y Ethereum local en :8546
```

De vuelta en la primera terminal:

```bash
npm run demo:local     # despliega en las dos redes, simula 120 días de historia y sincroniza
npm run dev            # http://localhost:3000
```

La simulación arranca los nodos 120 días atrás y "vive" la historia: rondas que abren y cierran, rentas, pagos con WBTC y ETH, y un mercado secundario con decenas de operaciones. Termina en la fecha de hoy.

### Billetera para la demo

En MetaMask, agregá dos redes:

| Red | RPC | chainId | Moneda |
|---|---|---|---|
| Polygon (red local) | `http://127.0.0.1:8545` | `31337` | POL |
| Ethereum (red local) | `http://127.0.0.1:8546` | `31338` | ETH |

Después importá alguna de estas cuentas. Sus claves son públicas: no las uses en ninguna otra red.

| Cuenta | Para qué sirve | Clave privada |
|---|---|---|
| #2 `0x3C44…93BC` | Tiene KYC, tenencias, rentas y órdenes en el mercado | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| #15 `0xcd3B…ce71` | No tiene KYC: sirve para recorrer el alta completa | `0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61` |

Las cuentas #16 a #19 también arrancan sin KYC. El panel de inversión ofrece cargar USDC, WBTC y USDT de prueba.

Si reiniciás los nodos, hacé dos cosas:

- Corré de nuevo `npm run demo:local`. La sincronización detecta que las redes son nuevas y rehace el índice. Los legajos aprobados se conservan: cada usuario vuelve a habilitar su billetera desde `/kyc`.
- En MetaMask, entrá a *Configuración → Avanzado → Borrar datos de actividad*, porque guarda los nonces de la red anterior.

## Testnet: Polygon Amoy + Ethereum Sepolia

El deploy corre en GitHub Actions, así la clave nunca pasa por ninguna computadora ni por el chat. Se puede arrancar con una sola red (por ejemplo, Sepolia) y sumar la otra después: los proyectos de la red que falta muestran "Contratos pendientes".

1. **Billeteras.** En MetaMask, usá dos cuentas nuevas, solo para testnet:
   - **deploy**: despliega y administra los contratos. Es la única que necesita moneda de prueba.
   - **agente KYC**: la usa la app para dar de alta inversores. El deploy le pasa el gas que necesita.
2. **Gas de prueba** para la cuenta de deploy:
   - **Sepolia (ETH):** la [canilla de Google Cloud](https://cloud.google.com/application/web3/faucet/ethereum/sepolia).
   - **Amoy (POL):**
     - la [canilla de Polygon](https://faucet.polygon.technology/);
     - [Alchemy](https://www.alchemy.com/faucets/polygon-amoy): 0,5 POL por día con una cuenta gratuita, que se crea con email;
     - [QuickNode](https://faucet.quicknode.com/polygon/amoy): conectando MetaMask;
     - [GetBlock](https://getblock.io/faucet/matic-amoy/).

   Un deploy completo usa unos 19 millones de gas por red, y los datos de demo unos 2,2 millones más. En Amoy, con el gas a 30 gwei, eso son unos 0,85 POL contando el margen. El workflow controla el saldo antes de empezar y avisa cuánto falta.
3. **GitHub.** Entrá a *Settings → Secrets and variables → Actions*:
   - pestaña *Secrets*: `DEPLOYER_PRIVATE_KEY`, la clave privada de la cuenta de deploy (en MetaMask: *Detalles de la cuenta → Mostrar clave privada*; con o sin `0x` adelante);
   - pestaña *Variables*: `KYC_AGENT_ADDRESS`, la dirección pública de la cuenta del agente.
   - Opcional, en *Secrets*: `AMOY_RPC_URL` y `SEPOLIA_RPC_URL` (Alchemy, Infura). Sin ellos, o si no responden, el workflow usa el primer RPC público que conteste con la red correcta.

   El nombre del secret tiene que ser exacto, y un secret no se puede renombrar: si quedó mal, creá otro y borrá el viejo. En este repo la clave quedó como `DEPLOYES_PRIVATE_KEYS` y el workflow acepta ese nombre también.
4. **Deploy.** En *Actions → Deploy a testnet → Run workflow*, elegí la red (`sepolia`, `amoy` o las dos) y dejá tildado "Cargar datos de demo". El workflow:
   - despliega;
   - commitea `blockchain/deployments/<chainId>.json`;
   - completa la ronda de los proyectos que en la demo ya estaban fondeados y publica órdenes de compra y venta, así el mercado P2P se puede usar desde el primer día;
   - deja las direcciones, con enlaces al explorador, en el resumen de la corrida;
   - revisa el deploy contra la cadena: contratos, agente KYC con rol y gas, rondas, transferencias y órdenes del mercado.

   Si algo falla, el motivo queda como aviso en la corrida, sin entrar al log. Si los datos de demo fallan por falta de gas, cargá más y corré de nuevo con la acción `solo-datos-de-demo`. La acción `verificar` solo hace la revisión.

Sin GitHub Actions también funciona:

```bash
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
npm --prefix blockchain run deploy:sepolia
npx hardhat run scripts/seed-testnet.ts --network sepolia   # en blockchain/
```

En mainnet, el deploy exige `CONFIRM_MAINNET=1`, usa USDC real y Uniswap V3 (`config/mainnet.json`), y el KYC simulado queda bloqueado. Los datos de demo no se cargan nunca en mainnet.

## Publicar la app en tokenarg.net.ar

La app corre en [Vercel](https://vercel.com) con una base Postgres de [Neon](https://neon.tech). Los dos tienen plan gratuito para la demo. El plan Hobby de Vercel es para uso personal y no comercial: para operar el negocio, pasá a Pro.

1. **Proyecto.** En vercel.com, entrá con tu cuenta de GitHub. Andá a *Add New → Project* e importá `TokenARG`. Vercel detecta Next.js solo y no hace falta tocar el comando de build. El script `vercel-build` hace esto:
   - aplica las migraciones;
   - carga el catálogo de proyectos;
   - importa los contratos de `blockchain/deployments/`;
   - compila la app.
2. **Base de datos.** En el proyecto, andá a *Storage → Create Database → Neon* y conectala. Vercel agrega `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
3. **Variables.** En *Settings → Environment Variables*, cargá estas. Para los secretos, usá textos al azar: `openssl rand -base64 48` o el generador de tu gestor de contraseñas.

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_NETWORK_MODE` | `testnet` |
   | `NEXT_PUBLIC_APP_URL` | `https://tokenarg.net.ar` |
   | `SESSION_SECRET` | 48 caracteres al azar |
   | `CRON_SECRET` | 32 caracteres al azar (Vercel lo usa para autenticar el cron diario) |
   | `KYC_WEBHOOK_SECRET` | 32 caracteres al azar |
   | `KYC_PROVIDER` / `ALLOW_MOCK_KYC` | `mock` / `true` (KYC simulado para la demo) |
   | `KYC_AGENT_PRIVATE_KEY` | clave privada de la cuenta del agente KYC |
   | `RPC_URL_11155111` / `RPC_URL_80002` | opcional: RPC privados (Alchemy) para Sepolia y Amoy |

   Después, *Deployments → Redeploy*.
4. **Dominio.**
   - En Vercel, entrá a *Settings → Domains* y agregá `tokenarg.net.ar` y `www.tokenarg.net.ar`. Elegí la opción de *nameservers* de Vercel.
   - En [nic.ar](https://nic.ar/), entrá a *Mis dominios → tokenarg.net.ar → Delegar*. Cargá `ns1.vercel-dns.com` y `ns2.vercel-dns.com`.

   La delegación tarda desde minutos hasta unas horas. Vercel emite el certificado HTTPS solo.

Cada vez que el workflow de deploy commitea direcciones nuevas, Vercel vuelve a desplegar y las importa. `vercel.json` programa una sincronización diaria con la blockchain. Las compras y las operaciones del mercado se registran al instante desde la propia app.

## Variables de entorno

Todas están documentadas en `.env.example`. Las principales:

| Variable | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `NEXT_PUBLIC_NETWORK_MODE` | `local`, `testnet` o `mainnet` |
| `RPC_URL_<chainId>` / `NEXT_PUBLIC_RPC_URL_<chainId>` | RPC del servidor y del navegador por red. Si faltan, se usan los públicos. |
| `KYC_AGENT_PRIVATE_KEY` | Billetera con `AGENT_ROLE` en el registro de cada red. En producción, guardala en un KMS. |
| `KYC_PROVIDER` | `mock` (simulado) o `webhook` (proveedor real a través de un adaptador) |
| `KYC_WEBHOOK_SECRET` | HMAC-SHA256 del webhook del proveedor |
| `SESSION_SECRET` | Firma de las cookies de sesión (32 caracteres como mínimo) |
| `CRON_SECRET` | Protege `/api/cron/sync` |
| `ALLOW_MOCK_KYC` | Habilita el KYC simulado en builds de producción, solo en testnet |

Las direcciones de los contratos no van en el `.env`: salen de `blockchain/deployments/<chainId>.json` y las carga `npm run chain:sync`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | App Next.js |
| `npm run setup:env` | Crea `.env` con secretos aleatorios |
| `npm run db:up` / `db:migrate` / `db:seed` / `db:reset` | Base de datos |
| `npm run chain:node` | Los dos nodos locales de Hardhat |
| `npm run chain:deploy:local` | Despliega en las dos redes locales |
| `npm --prefix blockchain run deploy:amoy` / `deploy:sepolia` | Despliega en testnet desde tu máquina |
| `npm run chain:simulate` | Historia de demo: KYC, compras, cierres, rentas y mercado (solo redes locales) |
| `npx hardhat run scripts/seed-testnet.ts --network sepolia` | Datos de demo en testnet: ronda fondeada y órdenes en el mercado (en `blockchain/`) |
| `npm run chain:sync` | Importa los deploys de las redes activas y sincroniza el índice |
| `npm run demo:local` | Las tres anteriores en orden |
| `npm run abis` | Regenera `src/lib/contracts/abis.ts` desde los contratos compilados |
| `npm run docs:generate` | Regenera los PDF de ejemplo (requiere `pip install reportlab`) |
| `SLUG=… AMOUNT_USD=… npm --prefix blockchain run distribute -- --network amoy` | Deposita rentas en un proyecto |
| `npm --prefix blockchain run finalize -- --network amoy` | Cierra las rondas vencidas |

## Pruebas

```bash
npm run contracts:test   # contratos: integración en TypeScript y fuzzing en Solidity
npm run typecheck && npm run lint && npm run build
npm run smoke            # 30 chequeos de la API contra la app corriendo y las dos redes locales
npx playwright install chromium
npm run test:e2e         # interfaz con una billetera simulada multi-red
```

La prueba de humo y las e2e necesitan la app corriendo (`npm run dev` o `npm start`) y los nodos locales con `demo:local`. El workflow de CI hace todo esto en cada push.

- **Prueba de humo.** Recorre el alta como en producción: billetera nueva, SIWE firmado desde Ethereum, legajo y webhook con HMAC. Al final verifica que la billetera quedó habilitada en las dos redes. También controla los rechazos esperados: firma inválida, red ajena, origen ajeno, nonce reutilizado y transacción inexistente.
- **e2e.** Cubren:
  - alta completa;
  - inversión con USDC en Polygon;
  - inversión pagando con ETH en Ethereum, con cambio de red;
  - compra en el mercado secundario;
  - publicar y retirar una orden;
  - cartera, filtros y vista móvil.

## Estructura

```
tokenarg/
├── .github/workflows/          ci.yml (pruebas) y deploy-testnet.yml (Amoy + Sepolia)
├── blockchain/                 Workspace de Hardhat 3
│   ├── contracts/              IdentityRegistry, AssetToken, TokenOffering, P2PMarket, payments/, mocks/
│   ├── scripts/                deploy, preflight, simulate-activity, finalize, distribute, export-abis
│   ├── test/                   Tests de integración (node:test + viem) y fuzzing en Solidity
│   ├── config/mainnet.json     USDC, Uniswap V3 y monedas aceptadas en Polygon y Ethereum
│   └── deployments/            Direcciones de cada deploy, por chainId
├── data/projects.json          Proyectos de ejemplo con su red (los usan el seed, el deploy y la simulación)
├── prisma/                     schema.prisma, migraciones y seed
├── public/docs/                PDF de ejemplo (contratos de fideicomiso, tasaciones…)
├── scripts/                    sync-chain, smoke-test, setup-env, generate-sample-docs
├── e2e/                        Playwright con billetera EIP-1193 conectada a las dos redes locales
└── src/
    ├── app/                    Páginas (/, /project/[slug], /mercado, /kyc, /portfolio) y API
    ├── components/             Panel de inversión, market/ (gráfico, libro de órdenes), KYC, cartera, logo…
    ├── hooks/                  useAssetInvestment (compra y pagos), useTokenMarket (P2P), useSession (SIWE)…
    ├── lib/                    Redes, ABIs, formato, cuentas del mercado, configuración de wagmi
    └── server/                 Prisma, sesiones, KYC, agente on-chain, indexador, mercado
```

## Seguridad

Lo que ya está resuelto:

- La sesión exige una firma SIWE desde una de las redes de la app. Se validan el dominio, el nonce de un solo uso, la red y el vencimiento. Las cookies van firmadas con HMAC y las operaciones que cambian estado controlan el `Origin`.
- Las inversiones y las operaciones del mercado se indexan solo a partir de recibos leídos de la blockchain. El cliente nunca informa montos.
- El webhook KYC se valida con HMAC sobre el cuerpo crudo y una comparación en tiempo constante. Es idempotente: antes de cada alta se lee la blockchain, así que un reintento no gasta gas. Un rechazo da de baja la billetera en todas las redes.
- Las autorizaciones son siempre por montos exactos, nunca ilimitadas. Esto vale para:
  - el USDC de la ronda;
  - la moneda que se usa para pagar, por la cotización + 1 %;
  - el mercado, por lo comprometido en las órdenes.
- Cada operación se simula antes de pedir la firma.
- El router de pagos no guarda saldos entre transacciones: lo verifica al final de cada compra. Solo los routers autorizados por cada oferta pueden comprar a nombre de un inversor.
- La billetera agente no tiene permisos sobre tokens ni fondos. Los datos personales nunca van on-chain.
- La configuración de wagmi se crea una vez por solicitud. Con una instancia global, el servidor mezclaba la billetera de un visitante en la página de otro.

Lo que falta antes de operar con dinero real:

- Auditoría externa de los contratos, en especial `P2PMarket`, `PaymentRouter` y `UniswapV3Adapter`.
- Una multisig (por ejemplo, Safe) como administradora, tesorería y receptora de comisiones: `ADMIN_ADDRESS`, `TREASURY_ADDRESS` y `FEE_RECIPIENT_ADDRESS` en el deploy.
- La llave del agente en un KMS o HSM.
- Límites de frecuencia (rate limiting) en la API.
- Cifrado en reposo del CUIT.
- Un adaptador para el proveedor KYC real, en `src/server/kyc/provider.ts`.
- Monitoreo del indexador y alertas de precio en el mercado.

## Marco regulatorio argentino

Este resumen refleja la normativa vigente a octubre de 2026 y no es asesoramiento legal. Antes de lanzar, hay que validarlo con un estudio especializado en mercado de capitales.

- **Fideicomisos.** Los rige el Código Civil y Comercial (arts. 1666 a 1707). La Ley 26.994 derogó los artículos sobre fideicomiso de la Ley 24.441. Para ofrecer participaciones al público hace falta un **fideicomiso financiero** con oferta pública autorizada por la CNV y un fiduciario inscripto (arts. 1690 a 1692). Un fideicomiso ordinario no alcanza.
- **Tokenización.** La RG CNV 1069/2025 creó un régimen de prueba (*sandbox*) para la representación digital de valores negociables (Título XXII de las Normas). Lo ampliaron las RG 1081/2025, 1087/2025 y 1150/2026: hoy admite fideicomisos financieros, fondos cerrados con activos reales, acciones, obligaciones negociables y CEDEAR. Rige hasta el **31/12/2027**. Requisitos:
  - la oferta pública tiene que estar autorizada;
  - el valor se deposita en un agente de depósito colectivo;
  - solo intervienen PSAV inscriptos en todas las categorías;
  - está prohibido negociar los tokens fuera de esos PSAV o en protocolos descentralizados.
- **El mercado P2P de este repo.** Está pensado para operar dentro de ese marco:
  - lo administra la plataforma;
  - solo lista tokens propios;
  - las dos partes tienen el KYC vigente;
  - el fiduciario decide cuándo habilitar las transferencias, que vienen apagadas.

  Para abrirlo al público, la plataforma tiene que ser PSAV inscripto, u operar a través de uno, con la negociación secundaria autorizada.
- **PSAV.** La Ley 27.739 (2024) creó la figura. La CNV la regula con las RG 994/2024 y 1058/2025, que fijan un patrimonio neto mínimo y exigen segregar los activos de los clientes. Cobrar USDC, convertir monedas, entregar tokens, intermediar en el mercado y custodiar son actividades de PSAV.
- **Financiamiento colectivo.** Es una vía alternativa, por la Ley 27.349 y las Plataformas de Financiamiento Colectivo de la CNV. Tiene topes por proyecto y por inversor, y la RG 1125/2026 agregó una modalidad de autorización automática.
- **Prevención de lavado y datos personales.** Para los PSAV rige la Resolución UIF 49/2024: debida diligencia, beneficiario final, regla de viaje y reportes de operaciones sospechosas. La RG CNV 1139/2026 actualizó los regímenes informativos. Los datos del legajo se rigen por la Ley 25.326, y la base debe inscribirse ante la AAIP.
- **Marca.** El logo usa los colores de la bandera con una moneda en lugar del Sol de Mayo. La Ley 22.362 (art. 3, inc. f) impide registrar como marca los signos que usa la Nación. Antes de presentarlo en el INPI, consultalo con un agente de la propiedad industrial.

Fuentes:

- [RG 1069/2025](https://www.boletinoficial.gob.ar/detalleAviso/primera/326947/20250613)
- [RG 1087/2025](https://www.boletinoficial.gob.ar/detalleAviso/primera/333326/20251023)
- [RG 1150/2026](https://www.boletinoficial.gob.ar/detalleAviso/primera/343010/20260611)
- [RG 994/2024](https://www.boletinoficial.gob.ar/detalleAviso/primera/305110/20240325)
- [Normas CNV, Título XIV, Capítulo III (PSAV)](https://servicios.infoleg.gob.ar/infolegInternet/anexos/215000-219999/219405/texact-TituloXIV-CapIII.htm)
- [Ley 27.349](https://servicios.infoleg.gob.ar/infolegInternet/anexos/270000-274999/273567/norma.htm)
- [Res. UIF 49/2024](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-49-2024-397597/texto)
- [Código Civil y Comercial, arts. 1666 y ss.](https://servicios.infoleg.gob.ar/infolegInternet/anexos/235000-239999/235975/norma.htm)
- [Ley 22.362 de Marcas](https://portaltramites.inpi.gob.ar/clasico/cursoagentes/marcas/22362.pdf)

## Solana (fase 2)

Solana no corre contratos EVM, así que no alcanza con desplegar los mismos contratos: hay que reescribirlos como programas. El diseño propuesto mantiene las mismas reglas:

| Pieza | En EVM (hoy) | En Solana |
|---|---|---|
| Token con KYC | `AssetToken` (ERC-20 que valida en `_update`) | Mint **SPL Token-2022** con la extensión *Transfer Hook*. Un programa propio valida en cada transferencia que origen y destino tengan KYC vigente. Alternativa más simple: *Default Account State = Frozen* y el agente "descongela" las cuentas verificadas. |
| Registro KYC | `IdentityRegistry` | Una cuenta PDA por billetera con el vencimiento, escrita solo por la autoridad del agente |
| Hash del contrato fiduciario | variable del token | Extensiones *Metadata Pointer* y *Token Metadata* del mint |
| Venta primaria | `TokenOffering` | Programa Anchor con escrow de USDC, mínimo, cupo y reembolsos |
| Rentas | dividendo por token | El mismo acumulador por token, en el programa del activo |
| Mercado P2P | `P2PMarket` | Programa Anchor de órdenes. Los DEX genéricos no siempre soportan *transfer hooks*. |
| Pagar con SOL u otras monedas | `PaymentRouter` + Uniswap | Swap con el agregador **Jupiter** a USDC en la misma transacción |
| Billeteras y login | wagmi + SIWE | Wallet Standard (Phantom, Solflare) + *Sign-In With Solana* |
| Índice | eventos por `chainId` | Webhooks de un proveedor RPC (por ejemplo, Helius) o polling de firmas. Se suma una "familia" `solana` al modelo `Network`. |

Para mover USDC entre Ethereum, Polygon y Solana existe CCTP de Circle. El backend ya está preparado para varias redes: cada proyecto tiene su red y el índice usa claves por red.

## Dominio

El dominio del proyecto es **tokenarg.net.ar**, registrado en NIC Argentina. Para publicar la app ahí, seguí [Publicar la app en tokenarg.net.ar](#publicar-la-app-en-tokenargnetar). `tokenarg.com` y `tokenarg.com.ar` están registrados por terceros desde el 26/09/2025.

## Próximos pasos sugeridos

1. **Demo pública**: deploy en testnet con el workflow y la app en tokenarg.net.ar (ver arriba).
2. **Proveedor KYC real**: un adaptador en `src/server/kyc/provider.ts` (Didit, Truora, RENAPER a través de un integrador).
3. **Pagos en pesos**: cuenta recaudadora (banco o PSP) que acredite USDC o emita los tokens al confirmarse la transferencia.
4. **Panel del fiduciario**: publicar proyectos, cargar documentos, depositar rentas, habilitar el mercado, pausar y cancelar, firmando con la multisig.
5. **Una sola firma**: *permit* de USDC (EIP-2612) para reemplazar el par aprobar + operar.
6. **Solana**: el diseño de la sección anterior.
