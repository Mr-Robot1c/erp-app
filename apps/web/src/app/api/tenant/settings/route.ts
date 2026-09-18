import { settingsSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { updateSettings } from "@/server/settings";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"], req);
  const body = settingsSchema.parse(await req.json());

  return tx((s) => updateSettings(s, m, body));
});
