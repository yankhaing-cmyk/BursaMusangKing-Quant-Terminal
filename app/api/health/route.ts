import { NextResponse } from "next/server";
import { isOwnerRequest, ownerOnlyResponse } from "@/app/lib/owner-auth";
import { getDashboardSnapshot, getPortfolioSnapshot } from "@/app/lib/repository";

export async function GET() {
  if (!(await isOwnerRequest())) return ownerOnlyResponse();
  const [snapshot, portfolio] = await Promise.all([
    getDashboardSnapshot({ pageSize: 10 }),
    getPortfolioSnapshot(),
  ]);
  return NextResponse.json(
    {
      mode: snapshot.mode,
      run: snapshot.run,
      issues: snapshot.issues,
      portfolio: {
        status: portfolio.status,
        methodologyVersion: portfolio.methodologyVersion,
        automaticExecution: portfolio.automaticExecution,
      },
      failClosed:
        snapshot.mode !== "LIVE" ||
        snapshot.run.status !== "ACTIVE" ||
        portfolio.status !== "ACTIVE",
    },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
