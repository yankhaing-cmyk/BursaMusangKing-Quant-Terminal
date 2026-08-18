import { NextRequest, NextResponse } from "next/server";
import { getStock } from "@/app/lib/repository";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const row = await getStock(symbol);
  return row
    ? NextResponse.json(row, {
        headers: { "Cache-Control": "public, max-age=30" },
      })
    : NextResponse.json({ error: "symbol_not_found" }, { status: 404 });
}

