import { NextResponse } from "next/server";
import { withActor } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getOnboarding } from "@/lib/senders/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await getOnboarding({ db: getDb().db }, actor);
    return NextResponse.json({
      steps: result.steps,
      completed: result.completed,
      total: result.total,
    });
  });
}
