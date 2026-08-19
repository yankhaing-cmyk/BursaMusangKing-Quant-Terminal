import { NextRequest, NextResponse } from "next/server";
import { isOwnerRequest, ownerOnlyResponse } from "@/app/lib/owner-auth";
import { getDashboardSnapshot } from "@/app/lib/repository";
import type { RankingQuery } from "@/app/lib/types";

export async function GET(request: NextRequest) {
  if (!(await isOwnerRequest())) return ownerOnlyResponse();
  const params = request.nextUrl.searchParams;
  const sort = params.get("sort") as RankingQuery["sort"];
  const direction = params.get("direction") as RankingQuery["direction"];
  const snapshot = await getDashboardSnapshot({
    search: params.get("search") ?? undefined,
    sector: params.get("sector") ?? undefined,
    minimumScore: Number(params.get("minimumScore") ?? 0),
    sort,
    direction,
    page: Number(params.get("page") ?? 1),
    pageSize: Number(params.get("pageSize") ?? 50),
  });
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}
