import { connection } from "next/server";
import { listDocuments, listFolders } from "@/lib/db";

export async function GET() {
  await connection();
  return Response.json({ folders: listFolders(), documents: listDocuments() });
}
