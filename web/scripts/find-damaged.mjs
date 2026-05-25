// Find unique damaged sequences (around U+FFFD) so we can build a repair table.
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

const seqs = new Map(); // sequence (after � up to 2 chars) → sample context

for (const rel of files) {
  const f = path.resolve(rel);
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xFFFD) {
      const window = text.slice(Math.max(0, i - 8), Math.min(text.length, i + 4));
      const tail = text.slice(i, Math.min(text.length, i + 3));
      const key = Array.from(tail).map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join(' ');
      if (!seqs.has(key)) seqs.set(key, []);
      if (seqs.get(key).length < 3) seqs.get(key).push(`${rel}: ${JSON.stringify(window)}`);
    }
  }
}

for (const [k, v] of seqs) {
  console.log('seq:', k);
  for (const s of v) console.log('   ', s);
  console.log();
}
