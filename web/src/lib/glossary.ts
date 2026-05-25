// Single source of truth mapping DB / old-UI jargon to plain-English UI labels
// and tooltip definitions. The Tip component reads from here.

export interface GlossaryEntry {
  /** The new UI label shown to users. */
  label: string;
  /** A plain-English explanation shown in the tooltip. */
  tip: string;
  /** Optional: a quick example to illustrate. */
  example?: string;
}

export const glossary: Record<string, GlossaryEntry> = {
  kpi: {
    label: 'KPI',
    tip: 'A measurable thing the plan rewards or watches — e.g. Total Revenue or Return %.',
    example: 'Total Revenue, Outlet Coverage, Return %',
  },
  slab: {
    label: 'Pay rate',
    tip: 'How much the employee earns at different levels of target achievement. Higher achievement = higher rate.',
    example: '85-95% achievement → 150 SAR per 1% above 85%',
  },
  slab_tier: {
    label: 'Rate band',
    tip: 'One row in the pay-rate ladder — a range (e.g. 85-95%) with a rate (e.g. 150 SAR).',
  },
  kpi_deduction: {
    label: 'Deduction band',
    tip: 'If a KPI falls into this band, the final payout is reduced by the listed percent. Used to dock employees for missing secondary targets.',
    example: 'Bad Return 0.4-0.5% → -10% deduction',
  },
  eligibility: {
    label: 'Qualifier',
    tip: 'A minimum bar the employee must clear to receive any commission. Fail any qualifier → zero or reduced payout.',
    example: 'Minimum monthly sales: 10,000 SAR',
  },
  multiplier: {
    label: 'Bonus',
    tip: 'Multiplies the final payout when a condition is met — e.g. +15% if revenue grew over 15% vs last year.',
  },
  capping: {
    label: 'Maximum payout',
    tip: 'Hard ceiling on what a single employee can earn from this plan in one period.',
    example: 'Max 10,000 SAR per plan / 150% of base salary',
  },
  split: {
    label: 'Role split',
    tip: 'Divides the commission across roles — e.g. supervisor takes 20% of their team-member\'s commission.',
  },
  fixed_incentive: {
    label: 'Fixed bonus',
    tip: 'A flat amount paid when a condition is met — e.g. 500 SAR if you onboard 5 new customers.',
  },
  mapping_filter: {
    label: 'What transactions count',
    tip: 'Restricts which transactions this plan sees — e.g. only sales of bakery products, only to Modern Trade customers.',
  },
  achievement_percent: {
    label: '% of target',
    tip: 'Actual divided by target × 100. 100% means hit the target exactly.',
  },
  net_payout: {
    label: 'Final payout',
    tip: 'What the employee actually receives after every adjustment (deductions, bonuses, penalties, cap).',
  },
  gross_payout: {
    label: 'Gross payout',
    tip: 'What the KPIs alone would pay, before deductions / bonuses / penalties / cap.',
  },
  rate_type_per_achievement_point: {
    label: 'SAR per 1% above min',
    tip: 'For every 1% the employee is above the band\'s minimum, they earn this much.',
    example: '150 SAR × (95% - 85%) = 1,500 SAR',
  },
  rate_type_percentage: {
    label: '% of base payout',
    tip: 'The band\'s rate is a percentage applied to the plan\'s base payout amount.',
  },
  rate_type_fixed: {
    label: 'Fixed amount',
    tip: 'A flat SAR amount, regardless of base payout or achievement.',
  },
  rate_type_per_unit: {
    label: 'SAR per unit',
    tip: 'Multiply by the actual value (units sold, customers visited, etc.).',
  },
  period: {
    label: 'Period',
    tip: 'The month (YYYY-MM) the calculation applies to. Commissions are computed per period.',
  },
  weight: {
    label: 'Weight',
    tip: 'How much of the total commission this KPI drives, as a percentage. All weights should sum to 100.',
    example: 'Revenue 60% + Coverage 20% + Returns 20% = 100',
  },
  direction_higher_is_better: {
    label: 'Higher is better',
    tip: 'Exceeding the target rewards the employee (e.g. Revenue).',
  },
  direction_lower_is_better: {
    label: 'Lower is better',
    tip: 'Going below the target rewards the employee (e.g. Return %, Overdue %).',
  },
};

export type GlossaryKey = string;

/** Convenience: get the plain-language label for a glossary key. */
export const label = (key: GlossaryKey) => glossary[key].label;
