import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/app/lib/repository";

export async function GET() {
  const snapshot = await getDashboardSnapshot({ pageSize: 10 });
  return NextResponse.json(
    {
      mode: snapshot.mode,
      run: snapshot.run,
      issues: snapshot.issues,
      failClosed: snapshot.mode !== "LIVE" || snapshot.run.status !== "ACTIVE",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

