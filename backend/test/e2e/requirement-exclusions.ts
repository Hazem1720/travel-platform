// M1 requirements that no e2e test names yet (E2E_PLAN.md section 2.1),
// with the reason. Each suite PR removes the IDs it covers. The gate fails on
// an entry that is no longer needed, so this list only shrinks.
// Started from the full M1 list minus what the first suites already name.
export const REQUIREMENT_EXCLUSIONS: Record<string, string> = {};
