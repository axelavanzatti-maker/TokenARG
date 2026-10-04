import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio-view";

export const metadata: Metadata = {
  title: "Mi cartera",
  description: "Tus tokens, tus rentas y tu historial de inversiones en TokenARG.",
};

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="display text-[2rem] text-ink sm:text-[2.4rem]">Mi cartera</h1>
      <div className="mt-6">
        <PortfolioView />
      </div>
    </div>
  );
}
