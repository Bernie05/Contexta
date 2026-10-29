import { connection } from "next/server";
import { jsonError, readJson } from "@/lib/http";
import { publicSettings, updateSettings } from "@/lib/settings";
import type { SettingsUpdate } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

export async function GET() {
  await connection();
  return Response.json(publicSettings());
}

export async function PUT(req: Request) {
  const body = await readJson<SettingsUpdate>(req);
  if (!body || typeof body !== "object") return jsonError(400, "Invalid JSON body.");
  if (body.providers !== undefined && !Array.isArray(body.providers)) return jsonError(400, "providers must be a list.");
  try {
    return Response.json(updateSettings(body));
  } catch (err) {
    return jsonError(400, errorMessage(err, "Invalid settings."));
  }
}
