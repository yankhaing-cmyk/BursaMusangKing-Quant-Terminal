import { QuantTerminal } from "@/app/components/QuantTerminal";
import { PwaRegister } from "@/app/components/PwaRegister";
import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { requireOwnerPage } from "@/app/lib/owner-auth";
import {
  getDashboardSnapshot,
  getPortfolioSnapshot,
  getResearchSnapshot,
  getTradeSnapshot,
} from "@/app/lib/repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const owner = await requireOwnerPage("/");
  if (!owner) {
    return (
      <main className="access-denied-shell">
        <section className="access-denied-card">
          <p className="eyebrow">PRIVATE QUANT RESEARCH</p>
          <h1>Owner access required</h1>
          <p>This terminal and its Bursa ranking data are restricted to the owner.</p>
          <a href={chatGPTSignOutPath("/")}>Sign out and use the owner account</a>
        </section>
      </main>
    );
  }
  const [snapshot, research, trades, portfolio] = await Promise.all([
    getDashboardSnapshot({ page: 1, pageSize: 100 }),
    getResearchSnapshot(),
    getTradeSnapshot(),
    getPortfolioSnapshot(),
  ]);
  return (
    <>
      <QuantTerminal
        initialSnapshot={snapshot}
        initialResearch={research}
        initialTrades={trades}
        initialPortfolio={portfolio}
      />
      <PwaRegister />
    </>
  );
}
