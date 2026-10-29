import { connection } from "next/server";
import { listModels } from "@/lib/llm";

export async function GET() {
  await connection();
  return Response.json(await listModels());
}
