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
  const user = await api("GET", "/v2/user");
  note("user", { status: user.status, version: user.json?.user?.version, defaultTeamId: user.json?.user?.defaultTeamId, err: err(user) });
  const teams = await api("GET", "/v2/teams?limit=20");
  note("teams", { status: teams.status, teams: (teams.json?.teams ?? []).map((t) => ({ id: t.id, slug: t.slug })), err: err(teams) });

  const project = await api("GET", `/v9/projects/${projectName}`);
  const teamId = project.json?.accountId;
  note("project", { status: project.status, accountId: teamId, err: err(project) });

  for (const [label, q] of [["sin teamId", ""], ["con teamId", `?teamId=${teamId}`]]) {
    const d = await api("GET", `/v5/domains/${domain}${q}`);
    note(`v5 domain ${label}`, { status: d.status, ...pick(d.json?.domain, DOMAIN_KEYS), keys: Object.keys(d.json?.domain ?? {}), err: err(d) });
    const c = await api("GET", `/v6/domains/${domain}/config${q}`);
    note(`v6 config ${label}`, { status: c.status, ...pick(c.json, ["configuredBy", "misconfigured", "serviceType", "nameservers", "aValues", "cnames", "conflicts", "acceptedChallenges", "recommendedIPv4", "recommendedCNAME"]), err: err(c) });
    const r = await api("GET", `/v4/domains/${domain}/records${q}`);
    note(`v4 records ${label}`, { status: r.status, count: r.json?.records?.length, records: (r.json?.records ?? []).map((x) => `${x.type} ${x.name} ${x.value}`), err: err(r) });
  }

  const q = `?teamId=${teamId}`;
  for (const name of [domain, `www.${domain}`]) {
    const pd = await api("GET", `/v9/projects/${project.json?.id}/domains/${name}${q}`);
    note(`project domain ${name}`, { status: pd.status, ...pick(pd.json, ["name", "apexName", "verified", "verification", "redirect", "gitBranch", "createdAt"]), err: err(pd) });
  }

  const patch = await api("PATCH", `/v3/domains/${domain}${q}`, { op: "update", zone: true });
  note("PATCH v3 zone (con teamId)", { status: patch.status, body: patch.json && !patch.json.error ? patch.json : undefined, err: err(patch) });
  const after = await api("GET", `/v5/domains/${domain}${q}`);
  note("v5 domain después", { status: after.status, ...pick(after.json?.domain, DOMAIN_KEYS), err: err(after) });
}

main().catch((e) => console.log(`::error title=diagnóstico::${esc(e?.stack ?? e)}`));
