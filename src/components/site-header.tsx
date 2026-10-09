"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IS_TESTNET, MODE_LABEL, NETWORK_MODE } from "@/lib/chains";
import { BrandLogo } from "./brand-mark";
import { ConnectButton } from "./connect-button";

const NAV = [
  { href: "/", label: "Proyectos", match: (p: string) => p === "/" || p.startsWith("/project") },
  { href: "/mercado", label: "Mercado", match: (p: string) => p.startsWith("/mercado") },
  { href: "/como-funciona", label: "Cómo funciona", match: (p: string) => p.startsWith("/como-funciona") },
  { href: "/portfolio", label: "Mi cartera", match: (p: string) => p.startsWith("/portfolio") },
  { href: "/kyc", label: "Verificación", match: (p: string) => p.startsWith("/kyc") },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0" aria-label="TokenARG, inicio">
          <BrandLogo />
        </Link>

        <nav aria-label="Principal" className="hidden md:block">
          <ul className="flex gap-1">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${active ? "text-ink" : "text-ink-muted hover:text-ink"}`}
                  >
                    <span className={active ? "border-b-2 border-brand pb-1" : ""}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {IS_TESTNET && (
            <span
              className="hidden rounded-full bg-caution-soft px-2.5 py-1 text-xs font-semibold text-caution sm:inline"
              title="Los activos, el USDC y las monedas de estas redes no tienen valor real"
            >
              {MODE_LABEL[NETWORK_MODE]}
            </span>
          )}
          <ConnectButton />
        </div>
      </div>

      <nav aria-label="Principal" className="border-t border-rule md:hidden">
        <ul className="mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-2">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block px-3 py-2.5 text-sm font-medium ${active ? "text-ink" : "text-ink-muted"}`}
                >
                  <span className={active ? "border-b-2 border-brand pb-1" : ""}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
