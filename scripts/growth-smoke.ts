/**
 * Prueba de captación contra una app corriendo: postulaciones de "Creá tu proyecto", lista de
 * espera con invitaciones y panel de administración (con la billetera de ADMIN_TEST_KEY, que
 * tiene que estar en ADMIN_WALLETS de la app).
 *
 * Uso: BASE_URL=http://localhost:3000 ADMIN_TEST_KEY=0x... npx tsx scripts/growth-smoke.ts
 * Deja datos de prueba en la base: no correr contra producción.
 */
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { APP_CHAINS } from "@/lib/chains";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const ADMIN_KEY = process.env.ADMIN_TEST_KEY as `0x${string}` | undefined;
if (!ADMIN_KEY)
  throw new Error(
    "Falta ADMIN_TEST_KEY: la clave de una billetera de prueba que esté en ADMIN_WALLETS.",
  );

const jar = new Map<string, string>();
async function call(
  path: string,
  init: { method?: string; body?: unknown; origin?: string } = {},
) {
  const headers: Record<string, string> = { origin: init.origin ?? BASE };
  if (jar.size)
    headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair = ""] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { text: text.slice(0, 120) };
  }
  return {
    status: res.status,
    json,
    text,
    type: res.headers.get("content-type"),
  };
}
let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(
    `${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + JSON.stringify(detail).slice(0, 300)}`,
  );
  if (!ok) fails++;
};

const t = Date.now();
// Postulaciones
const bad = await call("/api/applications", { body: { companyName: "x" } });
check(
  "postulación incompleta → 400 con mensajes",
  bad.status === 400 && /email|Contanos|Falta/.test(bad.json.error),
  bad.json,
);
const good = await call("/api/applications", {
  body: {
    companyName: "Edificio Sur SA",
    contactName: "Ana Pérez",
    email: `ana+${t}@example.com`,
    phone: "",
    category: "INMUEBLES",
    location: "Rosario, Santa Fe",
    amountUSD: 350000,
    description:
      "Edificio de 24 departamentos terminado en 2025, 80 % alquilado, sin deuda.",
    hasTrust: false,
    website: "",
    source: "prueba",
    acceptTerms: true,
    empresaWeb: "",
  },
});
check("postulación válida → 201", good.status === 201, good.json);
const bot = await call("/api/applications", {
  body: {
    companyName: "Spam SA",
    contactName: "Bot",
    email: `bot+${t}@example.com`,
    category: "AGRO",
    location: "Pergamino",
    amountUSD: 1,
    description: "x".repeat(40),
    hasTrust: false,
    acceptTerms: true,
    empresaWeb: "http://spam",
  },
});
check("postulación de bot → 201 sin guardar", bot.status === 201, bot.json);
const foreign = await call("/api/applications", {
  body: {},
  origin: "https://otro-sitio.example",
});
check(
  "postulación desde otro origen → 403",
  foreign.status === 403,
  foreign.json,
);

// Lista de espera e invitaciones
const a = await call("/api/waitlist", {
  body: {
    email: `a+${t}@example.com`,
    name: "A",
    ref: "",
    source: "instagram",
    acceptTerms: true,
    empresaWeb: "",
  },
});
check(
  "inscripción A",
  a.status === 200 && /^[a-z0-9]{8}$/.test(a.json.code),
  a.json,
);
const again = await call("/api/waitlist", {
  body: { email: `A+${t}@EXAMPLE.com`, acceptTerms: true },
});
check(
  "mismo email (otra capitalización) → mismo código",
  again.json.code === a.json.code,
  again.json,
);
const before = a.json.position;
const others = [];
for (let i = 0; i < 3; i++)
  others.push(
    await call("/api/waitlist", {
      body: { email: `o${i}+${t}@example.com`, acceptTerms: true },
    }),
  );
const b = await call("/api/waitlist", {
  body: { email: `b+${t}@example.com`, ref: a.json.code, acceptTerms: true },
});
check("inscripción B invitada por A", b.status === 200, b.json);
const statusA = await call(`/api/waitlist/${a.json.code}`);
check("A suma un invitado", statusA.json.referrals === 1, statusA.json);
check("A no baja de lugar al invitar", statusA.json.position <= before, {
  before,
  after: statusA.json.position,
});
const badRef = await call("/api/waitlist", {
  body: { email: `c+${t}@example.com`, ref: "noexiste9", acceptTerms: true },
});
check(
  "código de invitación inexistente no rompe",
  badRef.status === 200,
  badRef.json,
);
check(
  "código inválido → 400",
  (await call("/api/waitlist/NO!")).status === 400,
);
check(
  "código desconocido → 404",
  (await call("/api/waitlist/zzzzzzzz")).status === 404,
);
check(
  "sin aceptar → 400",
  (await call("/api/waitlist", { body: { email: `d+${t}@example.com` } }))
    .status === 400,
);

// Panel: sin sesión no hay CSV; con la billetera admin, sí.
check(
  "CSV sin sesión → 403",
  (await call("/api/admin/export?tipo=lista")).status === 403,
);
const account = privateKeyToAccount(ADMIN_KEY);
const { json: n } = await call("/api/auth/nonce");
const now = new Date();
const message = createSiweMessage({
  domain: new URL(BASE).host,
  uri: BASE,
  address: account.address,
  chainId: APP_CHAINS[1].id,
  nonce: n.nonce,
  version: "1",
  issuedAt: now,
  expirationTime: new Date(now.getTime() + 300000),
});
const login = await call("/api/auth/verify", {
  body: { message, signature: await account.signMessage({ message }) },
});
check("login SIWE admin", login.status === 200, login.json);
const panel = await call("/admin");
check(
  "panel muestra datos",
  panel.status === 200 &&
    panel.text.includes("Edificio Sur SA") &&
    panel.text.includes("instagram"),
  panel.status,
);
check(
  "panel no muestra la postulación del bot",
  !panel.text.includes("Spam SA"),
);
const csvList = await call("/api/admin/export?tipo=lista");
check(
  "CSV lista",
  csvList.status === 200 &&
    Boolean(csvList.type?.includes("text/csv")) &&
    csvList.text.includes(`a+${t}@example.com`),
  csvList.type,
);
const csvApps = await call("/api/admin/export?tipo=postulaciones");
check(
  "CSV postulaciones",
  csvApps.status === 200 && csvApps.text.includes("Edificio Sur SA"),
);
console.log(fails ? `\n${fails} fallas` : "\nTodo OK");
process.exit(fails ? 1 : 0);
