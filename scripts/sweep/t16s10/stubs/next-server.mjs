// next/server for a route called OUTSIDE a request: the real NextRequest/NextResponse, and an after()
// that records the promise instead of needing Next's request scope.
import { NextRequest } from "next/dist/server/web/spec-extension/request.js";
import { NextResponse } from "next/dist/server/web/spec-extension/response.js";
export { NextRequest, NextResponse };
export function after(p) { (globalThis.__T3.AFTER ||= []).push(p); }
