import { NextResponse } from 'next/server';

// GIT_COMMIT_SHA is baked in at Docker build time (see frontend/Dockerfile),
// never read at request time -- unlike NEXT_PUBLIC_* vars this one is only
// used server-side (this route handler), so it does not need the
// NEXT_PUBLIC_ prefix or build-time inlining into client bundles.
export async function GET() {
  return NextResponse.json({
    commitSha: process.env.GIT_COMMIT_SHA || 'UNKNOWN_COMMIT',
    buildTimestamp: process.env.BUILD_TIMESTAMP || null,
  });
}
