import { NextResponse } from "next/server";
import { isOwnerRequest, ownerOnlyResponse } from "@/app/lib/owner-auth";
import { getPortfolioSnapshot } from "@/app/lib/repository";

export async function GET() {
  if (!(await isOwnerRequest())) return ownerOnlyResponse();
  return NextResponse.json(await getPortfolioSnapshot(), {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
