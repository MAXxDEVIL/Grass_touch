import { NextResponse, type NextRequest } from "next/server";

/** POST-redirect-GET, so a refresh never re-submits a form. */
export function seeOther(
  request: NextRequest,
  path: string,
  params?: Record<string, string>,
): NextResponse {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}
