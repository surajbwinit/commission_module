// Repair files that PowerShell double-encoded (read UTF-8 as Latin-1, then wrote back as UTF-8).
// Strategy: for each affected file, reverse the corruption by reading current UTF-8 string,
// re-encoding to latin1 bytes, then decoding those bytes as UTF-8. Only run on files we know
// were touched by the bulk PS substitution — others may have correct UTF-8 we must not break.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const files = [
  'src/components/plan-builder/PlanBasicsCard.tsx',
  'src/components/plan-builder/MonitorMetricsCard.tsx',
  'src/components/plan-builder/PayoutStructureCard.tsx',
  'src/components/plan-builder/RulesCard.tsx',
  'src/components/plan-builder/ScopeCard.tsx',
  'src/components/plan-builder/AdjustmentsCard.tsx',
  'src/components/plan-builder/EligibilityCard.tsx',
  'src/components/plan-builder/DeductionBands.tsx',
  'src/components/plan-builder/SlabLadder.tsx',
  'src/app/plans/[id]/page.tsx',
  'src/app/employees/page.tsx',
  'src/app/audit/page.tsx',
  'src/app/approvals/page.tsx',
  'src/app/calculate/page.tsx',
  'src/app/transactions/page.tsx',
  'src/app/kpis/page.tsx',
  'src/app/simulate/page.tsx',
  'src/components/FormulaBuilder.tsx',
  'src/components/ui/Pill.tsx',
];

let touched = 0;
for (const rel of files) {
  const f = path.resolve(rel);
  let text;
  try { text = readFileSync(f, 'utf8'); }
  catch (e) { console.log('skip (missing):', rel); continue; }

  // Round-trip: current UTF-8 string → its underlying bytes interpreted as Latin-1 → reinterpret as UTF-8.
  const bytes = Buffer.from(text, 'latin1');
  let recovered;
  try {
    recovered = bytes.toString('utf8');
    // sanity: recovered should still decode and re-encode losslessly
    const reCheck = Buffer.from(recovered, 'utf8').toString('utf8');
    if (reCheck !== recovered) throw new Error('lossy');
  } catch (e) {
    console.log('skip (decode err):', rel);
    continue;
  }

  if (recovered === text) {
    console.log('no change:', rel);
    continue;
  }
  writeFileSync(f, recovered, 'utf8');
  touched++;
  console.log('fixed:', rel);
}
console.log(`\n${touched} file(s) repaired.`);
