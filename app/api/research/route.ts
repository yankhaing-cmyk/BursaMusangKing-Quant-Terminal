import { NextResponse } from "next/server";
import { isOwnerRequest, ownerOnlyResponse } from "@/app/lib/owner-auth";
import { getResearchSnapshot } from "@/app/lib/repository";

export async function GET() {
  if (!(await isOwnerRequest())) return ownerOnlyResponse();
  return NextResponse.json(await getResearchSnapshot(), {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
