import { NextRequest, NextResponse } from "next/server";
import { isOwnerRequest, ownerOnlyResponse } from "@/app/lib/owner-auth";
import { getStock } from "@/app/lib/repository";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  if (!(await isOwnerRequest())) return ownerOnlyResponse();
  const { symbol } = await context.params;
  const row = await getStock(symbol);
  return row
    ? NextResponse.json(row, {
        headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
      })
    : NextResponse.json(
        { error: "symbol_not_found" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
}
