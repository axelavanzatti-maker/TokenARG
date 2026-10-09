// Diagnóstico temporal del dominio en Vercel (rama de prueba; no va a main). No imprime secretos.
const API = "https://api.vercel.com";
const token = process.env.VERCEL_TOKEN?.trim();
const projectName = process.env.VERCEL_PROJECT?.trim() || "token-arg";
const domain = process.env.APP_DOMAIN?.trim() || "tokenarg.net.ar";

const esc = (s) => String(s).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const note = (title, data) => console.log(`::notice title=${title}::${esc(typeof data === "string" ? data : JSON.stringify(data))}`);

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));
const DOMAIN_KEYS = [
  "name", "serviceType", "verified", "zone", "cdnEnabled", "nameservers", "intendedNameservers", "customNameservers",
  "registrar", "boughtAt", "createdAt", "expiresAt", "transferredAt", "orderedAt", "renew", "teamId", "userId", "suffix",
];
const err = (r) => (r.json?.error ? { code: r.json.error.code, message: r.json.error.message } : undefined);

async function main() {
  const project = await api("GET", `/v9/projects/${projectName}`);
  const teamId = project.json?.accountId;
  const q = `?teamId=${teamId}`;
  const d = await api("GET", `/v5/domains/${domain}${q}`);
  note("v5 verificación", { status: d.status, ...pick(d.json?.domain, ["configVerifiedAt", "txtVerifiedAt", "nsVerifiedAt", "verificationRecord", "echMode"]) });
  const www = await api("GET", `/v9/projects/${project.json?.id}/domains/www.${domain}${q}`);
  note("project domain www", { status: www.status, ...pick(www.json, ["name", "apexName", "verified", "verification", "redirect", "redirectStatusCode"]), err: err(www) });
  const apex = await api("GET", `/v9/projects/${project.json?.id}/domains/${domain}${q}`);
  note("project domain apex", { status: apex.status, ...pick(apex.json, ["redirect", "redirectStatusCode", "verification"]), err: err(apex) });
  const patch = await api("PATCH", `/v3/domains/${domain}${q}`, { op: "update", zone: true });
  note("PATCH v3 zone con teamId", { status: patch.status, body: patch.json && !patch.json.error ? patch.json : undefined, err: err(patch) });
  const add = await api("POST", `/v7/domains${q}`, { method: "add", name: domain, zone: true });
  note("POST v7 add zone", { status: add.status, body: add.json && !add.json.error ? pick(add.json.domain ?? add.json, DOMAIN_KEYS) : undefined, err: err(add) });
  const after = await api("GET", `/v5/domains/${domain}${q}`);
  note("v5 después", { status: after.status, ...pick(after.json?.domain, ["serviceType", "zone", "nameservers", "intendedNameservers"]) });
}

main().catch((e) => console.log(`::error title=diagnóstico::${esc(e?.stack ?? e)}`));
