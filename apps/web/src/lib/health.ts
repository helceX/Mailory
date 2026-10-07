export type CheckResult = { ok: boolean };

/** Runs named checks concurrently; overall status is ok only if every check is. */
export async function runChecks(checks: Record<string, () => Promise<boolean>>) {
  const entries = await Promise.all(
    Object.entries(checks).map(
      async ([name, check]): Promise<[string, CheckResult]> => {
        try {
          return [name, { ok: await check() }];
        } catch {
          return [name, { ok: false }];
        }
      },
    ),
  );
  const results = Object.fromEntries(entries);
  return { ok: entries.every(([, r]) => r.ok), checks: results };
}
