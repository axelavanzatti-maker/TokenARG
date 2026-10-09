/**
 * Configura y publica la app en Vercel por la API, sin entrar al panel. Lo corre el workflow
 * "Publicar en Vercel" (.github/workflows/vercel.yml):
 *
 *   1. variables de entorno del proyecto. SESSION_SECRET y CRON_SECRET se generan solo si
 *      faltan, y la clave del agente KYC sale de un secret de GitHub;
 *   2. un deploy de producción de main, esperando el resultado (si falla, deja el final del log);
 *   3. los dominios (el principal y www, que redirige al principal) y si la delegación en nic.ar
 *      ya apunta a Vercel;
 *   4. un control del sitio publicado: páginas, sesión y contratos importados de cada red.
 *
 * Con ACCION=revisar solo hace 3 y 4 sobre el último deploy de producción (y muestra su log si
 * falló). Nunca imprime valores secretos. El resultado queda como avisos de la corrida.
 *
 * Variables: VERCEL_TOKEN (obligatoria), VERCEL_PROJECT (token-arg), APP_DOMAIN (tokenarg.net.ar),
 * ACCION (configurar-y-publicar | revisar), AGENT_SECRET y DEPLOYER_SECRET (clave del agente KYC).
 * Para probarlo contra servidores falsos: VERCEL_API (la API) y SITE_BASE (el sitio publicado).
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const API = process.env.VERCEL_API || "https://api.vercel.com";
const token = process.env.VERCEL_TOKEN?.trim();
const projectName = process.env.VERCEL_PROJECT?.trim() || "token-arg";
const domain = process.env.APP_DOMAIN?.trim() || "tokenarg.net.ar";
const action = process.env.ACCION || "configurar-y-publicar";
const DEPLOYMENTS = path.resolve(import.meta.dirname, "..", "blockchain", "deployments");
const NETWORKS = { 80002: "Polygon Amoy", 11155111: "Ethereum Sepolia" };
const VERCEL_NS = ["ns1.vercel-dns.com", "ns2.vercel-dns.com"];

// Avisos de la corrida ------------------------------------------------------------------------------
let failed = false;
const escapeData = (s) => String(s).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const escapeProp = (s) => escapeData(s).replaceAll(":", "%3A").replaceAll(",", "%2C");
function report(level, title, message) {
  console.log(`::${level} title=${escapeProp(title)}::${escapeData(message)}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const mark = level === "error" ? "✗" : level === "warning" ? "!" : "✓";
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${mark} **${title}:** ${message}\n`);
  }
  if (level === "error") failed = true;
}
const ok = (title, message) => report("notice", title, message);
const warn = (title, message) => report("warning", title, message);
const fail = (title, message) => report("error", title, message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// API de Vercel ------------------------------------------------------------------------------------
let scope = "";
async function api(method, url, body) {
  const full = `${API}${url}${scope ? `${url.includes("?") ? "&" : "?"}${scope}` : ""}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(full, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 300) };
      }
      return { ok: res.ok, status: res.status, json, error: json?.error?.message ?? json?.raw ?? `HTTP ${res.status}` };
    } catch (error) {
      if (attempt >= 3) return { ok: false, status: 0, json: null, error: String(error?.message ?? error) };
      await sleep(2000 * attempt);
    }
  }
}

/**
 * El proyecto. Con un token de equipo o de proyecto, Vercel deduce el equipo solo; con uno de
 * cuenta completa, el proyecto puede estar en cualquiera de los equipos.
 */
async function findProject() {
  const direct = await api("GET", `/v9/projects/${encodeURIComponent(projectName)}`);
  if (direct.ok) return direct.json;
  // Un token de proyecto no puede listar equipos: este pedido falla y no importa.
  const teams = await api("GET", "/v2/teams?limit=50");
  for (const team of teams.json?.teams ?? []) {
    scope = `teamId=${team.id}`;
    const res = await api("GET", `/v9/projects/${encodeURIComponent(projectName)}`);
    if (res.ok) return res.json;
  }
  scope = "";
  if ([401, 403].includes(direct.status) && !teams.ok) {
    fail(
      "Token de Vercel",
      `Vercel rechazó VERCEL_TOKEN o no le da acceso al proyecto "${projectName}": puede haber vencido o tener otro alcance. Creá otro en vercel.com/account/tokens con el alcance de tu equipo.`,
    );
  } else {
    fail("Proyecto de Vercel", `No encontré el proyecto "${projectName}" con este token. Si tiene otro nombre, cargalo en la variable VERCEL_PROJECT del repo.`);
  }
  return null;
}

// Clave del agente KYC -----------------------------------------------------------------------------
function normalizeKey(raw) {
  const key = (raw ?? "").replace(/\s+/g, "");
  if (/^[0-9a-fA-F]{64}$/.test(key)) return `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? key : "";
}

function deploymentFiles() {
  return Object.keys(NETWORKS)
    .map((id) => path.join(DEPLOYMENTS, `${id}.json`))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")));
}

/**
 * KYC_AGENT_PRIVATE_KEY si existe. Si no, y en todos los deploys el agente KYC es la misma
 * billetera que desplegó, la clave del deployer (es la misma cuenta).
 */
function agentKey() {
  const own = normalizeKey(process.env.AGENT_SECRET);
  if (own) return { key: own, source: "secret KYC_AGENT_PRIVATE_KEY" };
  const deployer = normalizeKey(process.env.DEPLOYER_SECRET);
  const files = deploymentFiles();
  const same = files.length > 0 && files.every((d) => d.kycAgent?.toLowerCase() === d.deployer?.toLowerCase());
  if (deployer && same) return { key: deployer, source: "secret del deployer (el agente KYC es la misma billetera)" };
  return { key: "", source: "" };
}

// 1. Variables de entorno --------------------------------------------------------------------------
async function configureEnv(project) {
  const res = await api("GET", `/v9/projects/${project.id}/env`);
  if (!res.ok) {
    fail("Variables de entorno", `No pude leerlas: ${res.error}`);
    return false;
  }
  const envs = res.json?.envs ?? [];
  const existing = (key) => envs.filter((e) => e.key === key);

  if (existing("DATABASE_URL").length === 0) {
    fail("Base de datos", "El proyecto no tiene DATABASE_URL. En Vercel: Storage → conectá la base (Prisma Postgres o Neon) al proyecto.");
    return false;
  }

  const all = ["production", "preview", "development"];
  const secretTargets = ["production", "preview"];
  const random = () => randomBytes(36).toString("base64url");
  const wanted = [
    { key: "NEXT_PUBLIC_NETWORK_MODE", value: "testnet", type: "encrypted", target: all },
    { key: "KYC_PROVIDER", value: "mock", type: "encrypted", target: all },
    { key: "ALLOW_MOCK_KYC", value: "true", type: "encrypted", target: all },
    { key: "NEXT_PUBLIC_APP_URL", value: `https://${domain}`, type: "encrypted", target: ["production"] },
  ];
  // Los secretos de la app se crean una sola vez: cambiarlos cerraría las sesiones abiertas.
  for (const key of ["SESSION_SECRET", "CRON_SECRET"]) {
    if (existing(key).length === 0) wanted.push({ key, value: random(), type: "sensitive", target: secretTargets });
  }
  const agent = agentKey();
  if (agent.key) {
    wanted.push({ key: "KYC_AGENT_PRIVATE_KEY", value: agent.key, type: "sensitive", target: secretTargets });
  } else if (existing("KYC_AGENT_PRIVATE_KEY").length === 0) {
    warn(
      "Agente KYC",
      "No hay clave para el agente KYC: sin ella nadie puede darse de alta. Cargala en el secret KYC_AGENT_PRIVATE_KEY del repo y volvé a correr este workflow.",
    );
  }
  for (const env of wanted) if (env.type === "sensitive") console.log(`::add-mask::${env.value}`);

  const changed = [];
  for (const env of wanted) {
    const current = existing(env.key);
    if (current.length === 0) {
      const created = await api("POST", `/v10/projects/${project.id}/env`, env);
      const error = created.json?.failed?.[0]?.error?.message;
      if (!created.ok || error) fail("Variables de entorno", `No pude crear ${env.key}: ${error ?? created.error}`);
      else changed.push(`${env.key} (nueva)`);
      continue;
    }
    // Ya existe (quizás cargada a mano): se actualiza el valor y se respetan sus entornos.
    for (const item of current) {
      const edited = await api("PATCH", `/v9/projects/${project.id}/env/${item.id}`, { value: env.value });
      if (!edited.ok) fail("Variables de entorno", `No pude actualizar ${env.key}: ${edited.error}`);
    }
    changed.push(env.key);
  }
  ok("Variables de entorno", `Listas: ${changed.join(", ")}.${agent.key ? ` La clave del agente KYC sale del ${agent.source}.` : ""}`);
  return !failed;
}

// 2. Deploy de producción --------------------------------------------------------------------------
async function deployMain(project) {
  const link = project.link;
  if (link?.type !== "github" || !link.repoId) {
    fail("Deploy", "El proyecto de Vercel no está conectado al repo de GitHub (Settings → Git).");
    return null;
  }
  const created = await api("POST", "/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1", {
    name: project.name,
    project: project.id,
    target: "production",
    gitSource: { type: "github", repoId: link.repoId, ref: link.productionBranch || "main" },
  });
  if (!created.ok) {
    fail("Deploy", `Vercel no aceptó el deploy: ${created.error}`);
    return null;
  }
  console.log(`Deploy ${created.json.id} en marcha (${created.json.url}).`);
  return waitFor(created.json.id);
}

async function waitFor(id) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 25 * 60_000) {
    const res = await api("GET", `/v13/deployments/${id}`);
    const state = res.json?.readyState ?? res.json?.status ?? "";
    if (state !== last) console.log(`  ${new Date().toISOString().slice(11, 19)} ${state}`);
    last = state;
    if (["READY", "ERROR", "CANCELED"].includes(state)) return res.json;
    await sleep(10_000);
  }
  fail("Deploy", `El deploy ${id} no terminó en 25 minutos.`);
  return null;
}

/** Las últimas líneas del log de un build fallido, sin los secretos (GitHub los enmascara igual). */
async function buildLogTail(id) {
  const res = await api("GET", `/v3/deployments/${id}/events?builds=1&limit=-1`);
  const events = Array.isArray(res.json) ? res.json : [];
  return events
    .flatMap((e) => String(e?.payload?.text ?? e?.text ?? "").split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-30);
}

async function reportDeployment(deployment) {
  const state = deployment.readyState ?? deployment.state ?? deployment.status;
  const id = deployment.id ?? deployment.uid;
  if (state === "READY") {
    ok("Deploy", `Producción publicada (${id}).`);
    return true;
  }
  const tail = await buildLogTail(id);
  console.log(`\nFinal del log del build:\n${tail.join("\n")}\n`);
  const missing = tail.filter((line) => line.startsWith("- ")).join(" ");
  const reason = deployment.errorMessage ? `${deployment.errorMessage}. ` : "";
  fail("Deploy", `El build terminó en ${state}. ${reason}${missing || tail.slice(-6).join(" · ")}`);
  return false;
}

// 3. Dominios --------------------------------------------------------------------------------------
async function configureDomains(project) {
  const res = await api("GET", `/v9/projects/${project.id}/domains`);
  const names = new Set((res.json?.domains ?? []).map((d) => d.name));
  for (const body of [{ name: domain }, { name: `www.${domain}`, redirect: domain, redirectStatusCode: 308 }]) {
    if (names.has(body.name)) continue;
    const added = await api("POST", `/v10/projects/${project.id}/domains`, body);
    if (added.ok) ok("Dominio", `${body.name} quedó agregado al proyecto.`);
    else if (added.status === 409) {
      fail("Dominio", `${body.name} está en otro proyecto de Vercel (¿uno importado dos veces?). Sacalo de ahí o borrá ese proyecto, y volvé a correr este workflow.`);
    } else if (added.status === 403) {
      warn("Dominio", `El token no puede agregar ${body.name} (¿es de proyecto?). Agregalo en Vercel: Settings → Domains → Add Domain.`);
    } else fail("Dominio", `No pude agregar ${body.name}: ${added.error}`);
  }
}

async function domainStatus(project) {
  const configured = async () => {
    const config = await api("GET", `/v6/domains/${domain}/config`);
    return { config, ready: config.ok && config.json?.misconfigured === false };
  };
  let { config, ready } = await configured();
  if (!ready && project) {
    // Le pide a Vercel que vuelva a mirar la delegación ahora, sin esperar su chequeo periódico.
    for (const name of [domain, `www.${domain}`]) await api("POST", `/v9/projects/${project.id}/domains/${name}/verify`);
    ({ config, ready } = await configured());
  }
  if (ready) {
    ok("Dominio", `${domain} ya apunta a Vercel y tiene certificado HTTPS.`);
    return true;
  }
  // Un token de proyecto no ve la configuración del dominio: se prueba el sitio directamente.
  if (!config.ok) {
    const live = await fetchText(`https://${domain}/`);
    if (live.status === 200 && live.text.includes("TokenARG")) return true;
  }
  const info = (await api("GET", `/v5/domains/${domain}`)).json?.domain ?? {};
  const current = (info.nameservers ?? []).map((n) => n.toLowerCase());
  const intended = info.intendedNameservers?.length ? info.intendedNameservers : VERCEL_NS;
  console.log(
    `Dominio según Vercel: ${JSON.stringify({ serviceType: info.serviceType, verified: info.verified, nameservers: info.nameservers, intendedNameservers: info.intendedNameservers, configuredBy: config.json?.configuredBy ?? null })}`,
  );
  const delegated = current.length > 0 && intended.every((ns) => current.includes(ns.toLowerCase()));
  warn(
    "Dominio",
    delegated
      ? `La delegación de ${domain} en nic.ar ya apunta a Vercel (${current.join(", ")}). Falta que Vercel active el dominio y emita el certificado: suele tardar minutos, a veces unas horas.`
      : `${domain} todavía no apunta a Vercel. En nic.ar (Mis dominios → Delegar) cargá ${intended.join(" y ")}` +
          `${current.length ? `; hoy está delegado a ${current.join(", ")}` : ""}. La delegación tarda de minutos a unas horas.`,
  );
  return false;
}

// 4. Control del sitio -----------------------------------------------------------------------------
async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "tokenarg-ci" } });
    return { status: res.status, text: await res.text() };
  } catch (error) {
    return { status: 0, text: String(error?.message ?? error) };
  }
}

async function checkSite(base, label) {
  base = process.env.SITE_BASE || base;
  const home = await fetchText(`${base}/`);
  if (home.status === 401 || home.status === 403) {
    warn(`Sitio (${label})`, `${base} pide iniciar sesión en Vercel (Deployment Protection): se revisa por el dominio propio.`);
    return;
  }
  if (home.status !== 200 || !home.text.includes("TokenARG")) {
    fail(`Sitio (${label})`, `${base} respondió ${home.status || "sin conexión"} en la página de inicio.`);
    return;
  }
  const checks = [`inicio`];
  const market = await fetchText(`${base}/mercado`);
  if (market.status === 200) checks.push("mercado");
  else fail(`Sitio (${label})`, `${base}/mercado respondió ${market.status}.`);
  const nonce = await fetchText(`${base}/api/auth/nonce`);
  if (nonce.status === 200 && nonce.text.includes("nonce")) checks.push("inicio de sesión");
  else fail(`Sitio (${label})`, `${base}/api/auth/nonce respondió ${nonce.status}: revisá SESSION_SECRET.`);

  for (const d of deploymentFiles()) {
    const [slug, project] = Object.entries(d.projects ?? {})[0] ?? [];
    if (!slug) continue;
    const page = await fetchText(`${base}/project/${slug}`);
    if (page.status === 200 && page.text.toLowerCase().includes(project.token.toLowerCase())) checks.push(`contratos de ${NETWORKS[d.chainId]}`);
    else fail(`Sitio (${label})`, `La página de ${slug} no muestra sus contratos de ${NETWORKS[d.chainId]}: el build no importó ese deploy.`);
  }
  ok(`Sitio (${label})`, `${base} anda: ${checks.join(", ")}.`);
}

function productionHost(project, deployment) {
  const aliases = [...(deployment?.alias ?? []), ...(project.targets?.production?.alias ?? [])];
  return aliases.find((a) => a.endsWith(".vercel.app") && !a.includes("-git-")) ?? aliases[0] ?? deployment?.url;
}

// Principal ----------------------------------------------------------------------------------------
async function main() {
  if (!token) {
    fail(
      "Token de Vercel",
      "Falta el secret VERCEL_TOKEN: crealo en vercel.com → Account Settings → Tokens y cargalo en GitHub → Settings → Secrets and variables → Actions → New repository secret.",
    );
    return;
  }
  const project = await findProject();
  if (!project) return;
  console.log(`Proyecto ${project.name} (${project.id})${scope ? `, ${scope}` : ""}.`);

  let deployment = null;
  if (action === "revisar") {
    const list = await api("GET", `/v6/deployments?projectId=${project.id}&target=production&limit=1`);
    deployment = list.json?.deployments?.[0] ?? null;
    if (!deployment) {
      warn("Deploy", "El proyecto todavía no tiene deploys de producción.");
      return;
    }
    if (!(await reportDeployment(deployment))) return;
  } else {
    if (!(await configureEnv(project))) return;
    deployment = await deployMain(project);
    if (!deployment || !(await reportDeployment(deployment))) return;
    await configureDomains(project);
  }

  const refreshed = (await api("GET", `/v9/projects/${project.id}`)).json ?? project;
  const host = productionHost(refreshed, deployment);
  if (host) await checkSite(`https://${host}`, host);
  if (await domainStatus(project)) await checkSite(`https://${domain}`, domain);
}

main()
  .catch((error) => fail("Publicar en Vercel", String(error?.stack ?? error).split("\n")[0]))
  .finally(() => {
    if (failed) process.exitCode = 1;
  });
