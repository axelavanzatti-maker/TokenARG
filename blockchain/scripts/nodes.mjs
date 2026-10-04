// Levanta los dos nodos locales de la demo en paralelo:
//   Polygon local  → http://127.0.0.1:8545 (chainId 31337)
//   Ethereum local → http://127.0.0.1:8546 (chainId 31338)
// Ctrl+C los detiene a ambos.
import { spawn } from "node:child_process";

const NODES = [
  { label: "polygon ", network: "polygonLocal", port: 8545 },
  { label: "ethereum", network: "ethereumLocal", port: 8546 },
];

const children = NODES.map(({ label, network, port }) => {
  const child = spawn("npx", ["hardhat", "node", "--network", network, "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `[${label}] ${line}`)
      .join("\n");
  child.stdout.on("data", (chunk) => console.log(prefix(chunk)));
  child.stderr.on("data", (chunk) => console.error(prefix(chunk)));
  child.on("exit", (code) => {
    console.log(`[${label}] el nodo terminó (código ${code})`);
    shutdown(code ?? 0);
  });
  return child;
});

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGINT");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
