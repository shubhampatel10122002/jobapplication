import { readFile } from "node:fs/promises";
import { getApplicationDetail } from "@/db/applications";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = await getApplicationDetail(Number(id));
  const screenshotPath = detail?.application.confirmationScreenshotPath;
  if (!screenshotPath) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const file = await readFile(screenshotPath);
    return new Response(new Uint8Array(file), {
      headers: { "content-type": "image/png" },
    });
  } catch {
    return new Response("Screenshot file missing", { status: 404 });
  }
}
