import { NextResponse } from "next/server";
import { MONUMENTS } from "@monumental/shared";

/** Public, built-in dataset (the live merged catalogue is served by the socket server at /monuments). */
export function GET() {
  return NextResponse.json({ monuments: MONUMENTS });
}
