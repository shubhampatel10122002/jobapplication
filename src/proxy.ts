import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional HTTP Basic Auth for hosted deployments (the app holds PII and can submit
 * applications). Enabled by setting APP_PASSWORD; no-op when unset (local dev).
 * Username is ignored — only the password matters (single-user app).
 */
export default function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const suppliedPassword = decoded.slice(decoded.indexOf(":") + 1);
      if (suppliedPassword === password) return NextResponse.next();
    } catch {
      // fall through to 401
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="JobPilot"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
