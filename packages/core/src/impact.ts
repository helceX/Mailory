export type ImpactGroup = {
  assigned: number;
  converted: number;
  sent: number;
  contaminated: number;
  erased: number;
};
/** Conservative difference of Wilson score bounds, not an attribution or profit estimate. */
function wilson(success: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96,
    p = success / n,
    den = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
export function evaluateImpact(
  treatment: ImpactGroup,
  control: ImpactGroup,
  ended: boolean,
  completed: boolean,
) {
  const rateT = treatment.assigned ? treatment.converted / treatment.assigned : 0;
  const rateC = control.assigned ? control.converted / control.assigned : 0;
  const t = wilson(treatment.converted, treatment.assigned),
    c = wilson(control.converted, control.assigned);
  const lower = t[0] - c[1],
    upper = t[1] - c[0];
  const sufficient =
    Math.min(treatment.assigned, control.assigned) >= 50 &&
    treatment.converted + control.converted >= 20;
  const compromised =
    treatment.contaminated + control.contaminated + treatment.erased + control.erased >
    0;
  const status = !ended
    ? "collecting"
    : !completed || compromised
      ? "compromised"
      : !sufficient
        ? "insufficient"
        : lower > 0
          ? "positive"
          : upper < 0
            ? "negative"
            : "inconclusive";
  return {
    rateT,
    rateC,
    difference: rateT - rateC,
    lower,
    upper,
    estimatedAdditional: (rateT - rateC) * treatment.assigned,
    status,
  };
}
