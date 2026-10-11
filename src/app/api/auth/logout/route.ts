import { type NextRequest } from "next/server";
import { seeOther } from "@/lib/http";
import { endSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  await endSession();
  return seeOther(request, "/");
}
