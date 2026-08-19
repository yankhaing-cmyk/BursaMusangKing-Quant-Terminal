import {
  getChatGPTUser,
  requireChatGPTUser,
  type ChatGPTUser,
} from "@/app/chatgpt-auth";

export const OWNER_EMAIL = "yankhaing@gmail.com";

export function isOwnerEmail(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === OWNER_EMAIL;
}

export async function requireOwnerPage(
  returnTo: string,
): Promise<ChatGPTUser | null> {
  const user = await requireChatGPTUser(returnTo);
  return isOwnerEmail(user.email) ? user : null;
}

export async function isOwnerRequest(): Promise<boolean> {
  const user = await getChatGPTUser();
  return isOwnerEmail(user?.email);
}

export function ownerOnlyResponse(): Response {
  return Response.json(
    { ok: false, error: "owner_access_required" },
    {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Authorization",
      },
    },
  );
}
