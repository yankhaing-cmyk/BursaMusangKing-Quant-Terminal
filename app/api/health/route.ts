import { NextResponse } from "next/server";
import { isOwnerRequest, ownerOnlyResponse } from "@/app/lib/owner-auth";
import { getDashboardSnapshot } from "@/app/lib/repository";

export async function GET() {
  if (!(await isOwnerRequest())) return ownerOnlyResponse();
  const snapshot = await getDashboardSnapshot({ pageSize: 10 });
  return NextResponse.json(
    {
      mode: snapshot.mode,
      run: snapshot.run,
      issues: snapshot.issues,
      failClosed: snapshot.mode !== "LIVE" || snapshot.run.status !== "ACTIVE",
    },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
