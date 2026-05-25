-- =====================================================================
-- Commission Engine — Schema (PostgreSQL native, port of server/src/db/schema.js)
--
-- Same database, same table names as the existing Node.js system.
-- Only the tech stack changes; this DDL is identical in semantics to
-- the original schema.js, translated from SQLite-flavor syntax (?/datetime('now'))
-- to native Postgres (DEFAULT NOW(), TIMESTAMPTZ).
--
-- All 41 tables. Run once via bootstrap or idempotent on app start.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reference / master data tables (synced from source DB)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  level         INTEGER NOT NULL DEFAULT 0,
  description   TEXT,
  is_field_role INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS territories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('national','region','area','territory')),
  parent_id  TEXT REFERENCES territories(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  external_id  TEXT,
  role_id      TEXT NOT NULL REFERENCES roles(id),
  territory_id TEXT REFERENCES territories(id),
  reports_to   TEXT REFERENCES employees(id),
  base_salary  NUMERIC(14,2) NOT NULL DEFAULT 0,
  hire_date    DATE NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  sku             TEXT NOT NULL UNIQUE,
  category        TEXT NOT NULL,
  subcategory     TEXT,
  unit_price      NUMERIC(14,4) NOT NULL DEFAULT 0,
  is_strategic    INTEGER NOT NULL DEFAULT 0,
  is_new_launch   INTEGER NOT NULL DEFAULT 0,
  tags            TEXT DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  channel             TEXT NOT NULL,
  channel_name        TEXT,
  customer_group      TEXT,
  customer_group_name TEXT,
  territory_id        TEXT REFERENCES territories(id),
  credit_limit        NUMERIC(14,2) DEFAULT 0,
  tags                TEXT DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- KPI library
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_definitions (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  code              TEXT NOT NULL UNIQUE,
  category          TEXT NOT NULL,
  description       TEXT,
  formula           TEXT NOT NULL,
  unit              TEXT NOT NULL DEFAULT 'currency',
  direction         TEXT NOT NULL DEFAULT 'higher_is_better'
                      CHECK (direction IN ('higher_is_better','lower_is_better')),
  applicable_roles  TEXT NOT NULL DEFAULT '[]',
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Commission plans + scope
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_plans (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','expired','archived')),
  plan_type       TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (plan_type IN ('monthly','quarterly','annual')),
  effective_from  DATE NOT NULL,
  effective_to    DATE NOT NULL,
  base_payout     NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'AED',
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_roles (
  id      TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id),
  UNIQUE (plan_id, role_id)
);

CREATE TABLE IF NOT EXISTS plan_territories (
  id           TEXT PRIMARY KEY,
  plan_id      TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  territory_id TEXT NOT NULL REFERENCES territories(id),
  UNIQUE (plan_id, territory_id)
);

-- Optional whitelist: when non-empty, narrows the role+territory match to
-- only these employees. Empty = no restriction (role+territory match wins).
CREATE TABLE IF NOT EXISTS plan_employees (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  UNIQUE (plan_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_employees_plan ON plan_employees(plan_id);

CREATE TABLE IF NOT EXISTS plan_kpis (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  kpi_id        TEXT NOT NULL REFERENCES kpi_definitions(id),
  weight        NUMERIC(7,2) NOT NULL DEFAULT 0,
  target_value  NUMERIC(18,4) NOT NULL DEFAULT 0,
  slab_set_id   TEXT,
  UNIQUE (plan_id, kpi_id)
);

CREATE TABLE IF NOT EXISTS plan_kpi_monthly_targets (
  id           TEXT PRIMARY KEY,
  plan_id      TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  kpi_id       TEXT NOT NULL REFERENCES kpi_definitions(id),
  role_id      TEXT REFERENCES roles(id),
  period       TEXT NOT NULL,
  target_value NUMERIC(18,4) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, kpi_id, role_id, period)
);

CREATE TABLE IF NOT EXISTS plan_fixed_incentives (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  role_id             TEXT REFERENCES roles(id),
  period              TEXT,
  name                TEXT NOT NULL,
  amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
  condition_kpi_id    TEXT REFERENCES kpi_definitions(id),
  condition_operator  TEXT DEFAULT '>='
                        CHECK (condition_operator IN ('>=','<=','>','<','=')),
  condition_value     NUMERIC(18,4),
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Slab configuration
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slab_sets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'step'
                CHECK (type IN ('step','progressive','accelerator','decelerator','reverse','open_ended')),
  plan_id     TEXT REFERENCES commission_plans(id) ON DELETE CASCADE,
  kpi_id      TEXT REFERENCES kpi_definitions(id),
  role_id     TEXT REFERENCES roles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE plan_kpis
  DROP CONSTRAINT IF EXISTS plan_kpis_slab_set_fk;

ALTER TABLE plan_kpis
  ADD CONSTRAINT plan_kpis_slab_set_fk
  FOREIGN KEY (slab_set_id) REFERENCES slab_sets(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS slab_tiers (
  id            TEXT PRIMARY KEY,
  slab_set_id   TEXT NOT NULL REFERENCES slab_sets(id) ON DELETE CASCADE,
  tier_order    INTEGER NOT NULL,
  min_percent   NUMERIC(10,4) NOT NULL,
  max_percent   NUMERIC(10,4),
  rate          NUMERIC(14,4) NOT NULL DEFAULT 0,
  rate_type     TEXT NOT NULL DEFAULT 'percentage'
                  CHECK (rate_type IN ('percentage','fixed','per_unit','per_achievement_point')),
  min_inclusive INTEGER NOT NULL DEFAULT 1,
  max_inclusive INTEGER NOT NULL DEFAULT 0,
  UNIQUE (slab_set_id, tier_order)
);

-- ---------------------------------------------------------------------
-- Rule engine
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rule_sets (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rules (
  id                 TEXT PRIMARY KEY,
  rule_set_id        TEXT NOT NULL REFERENCES rule_sets(id) ON DELETE CASCADE,
  parent_rule_id     TEXT REFERENCES rules(id) ON DELETE CASCADE,
  dimension          TEXT NOT NULL
                       CHECK (dimension IN
                         ('product','customer','product_category','product_sku',
                          'customer_channel','customer_group','territory','transaction_type')),
  rule_type          TEXT NOT NULL CHECK (rule_type IN ('include','exclude')),
  match_type         TEXT NOT NULL DEFAULT 'exact'
                       CHECK (match_type IN ('exact','category','tag')),
  match_values       TEXT NOT NULL DEFAULT '[]',
  priority           INTEGER NOT NULL DEFAULT 0,
  valid_from         DATE,
  valid_to           DATE,
  conditional_logic  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eligibility_rules (
  id                TEXT PRIMARY KEY,
  plan_id           TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  metric            TEXT NOT NULL
                      CHECK (metric IN
                        ('min_sales','min_collection_percent','max_return_percent',
                         'min_active_days','min_lines_sold')),
  operator          TEXT NOT NULL DEFAULT '>='
                      CHECK (operator IN ('>=','<=','>','<','=')),
  threshold         NUMERIC(18,4) NOT NULL,
  action            TEXT NOT NULL DEFAULT 'zero_payout'
                      CHECK (action IN ('zero_payout','reduce_percent','warning_only')),
  reduction_percent NUMERIC(7,2) DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS multiplier_rules (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL
                        CHECK (type IN
                          ('growth','strategic_sku','new_launch','channel_mix','collection_speed')),
  condition_metric    TEXT NOT NULL,
  condition_operator  TEXT NOT NULL DEFAULT '>='
                        CHECK (condition_operator IN ('>=','<=','>','<','=')),
  condition_value     NUMERIC(18,4) NOT NULL,
  multiplier_value    NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  stacking_mode       TEXT NOT NULL DEFAULT 'multiplicative'
                        CHECK (stacking_mode IN ('additive','multiplicative','highest_only')),
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kpi_deduction_rules (
  id                TEXT PRIMARY KEY,
  plan_id           TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  kpi_id            TEXT REFERENCES kpi_definitions(id),
  role_id           TEXT REFERENCES roles(id),
  name              TEXT NOT NULL,
  metric_type       TEXT NOT NULL DEFAULT 'shortfall_percent'
                      CHECK (metric_type IN ('shortfall_percent','achievement_percent','actual_value')),
  min_value         NUMERIC(18,4),
  max_value         NUMERIC(18,4),
  min_inclusive     INTEGER NOT NULL DEFAULT 1,
  max_inclusive     INTEGER NOT NULL DEFAULT 1,
  deduction_percent NUMERIC(7,2) NOT NULL DEFAULT 0,
  priority          INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS penalty_rules (
  id                TEXT PRIMARY KEY,
  plan_id           TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  trigger_metric    TEXT NOT NULL,
  trigger_operator  TEXT NOT NULL DEFAULT '>'
                      CHECK (trigger_operator IN ('>=','<=','>','<','=')),
  trigger_value     NUMERIC(18,4) NOT NULL,
  penalty_type      TEXT NOT NULL DEFAULT 'percentage'
                      CHECK (penalty_type IN ('percentage','fixed','slab_downgrade')),
  penalty_value     NUMERIC(14,4) NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capping_rules (
  id         TEXT PRIMARY KEY,
  plan_id    TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  cap_type   TEXT NOT NULL CHECK (cap_type IN ('max_per_plan','percent_of_salary','max_per_kpi')),
  cap_value  NUMERIC(14,4) NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS split_rules (
  id                TEXT PRIMARY KEY,
  plan_id           TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  trigger_condition TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS split_participants (
  id            TEXT PRIMARY KEY,
  split_rule_id TEXT NOT NULL REFERENCES split_rules(id) ON DELETE CASCADE,
  role_id       TEXT NOT NULL REFERENCES roles(id),
  split_percent NUMERIC(7,2) NOT NULL,
  UNIQUE (split_rule_id, role_id)
);

-- ---------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id               TEXT PRIMARY KEY,
  employee_id      TEXT NOT NULL REFERENCES employees(id),
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  product_id       TEXT NOT NULL REFERENCES products(id),
  transaction_type TEXT NOT NULL DEFAULT 'sale'
                     CHECK (transaction_type IN ('sale','return','collection')),
  quantity         NUMERIC(14,4) NOT NULL DEFAULT 0,
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  transaction_date DATE NOT NULL,
  period           TEXT NOT NULL,
  territory_id     TEXT REFERENCES territories(id),
  currency         TEXT DEFAULT 'AED',
  base_amount      NUMERIC(14,2),
  exchange_rate    NUMERIC(14,6),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Calculation outputs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calculation_runs (
  id                   TEXT PRIMARY KEY,
  plan_id              TEXT NOT NULL REFERENCES commission_plans(id),
  period               TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running','completed','failed','locked')),
  is_simulation        INTEGER NOT NULL DEFAULT 0,
  simulation_params    TEXT,
  total_payout         NUMERIC(18,2) DEFAULT 0,
  employee_count       INTEGER DEFAULT 0,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  calculation_details  TEXT DEFAULT '{}',
  created_by           TEXT
);

CREATE TABLE IF NOT EXISTS employee_payouts (
  id                       TEXT PRIMARY KEY,
  run_id                   TEXT NOT NULL REFERENCES calculation_runs(id),
  employee_id              TEXT NOT NULL REFERENCES employees(id),
  plan_id                  TEXT NOT NULL REFERENCES commission_plans(id),
  period                   TEXT NOT NULL,
  gross_payout             NUMERIC(14,2) NOT NULL DEFAULT 0,
  kpi_deduction_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  fixed_incentive_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  multiplier_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  cap_adjustment           NUMERIC(14,2) NOT NULL DEFAULT 0,
  split_adjustment         NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payout               NUMERIC(14,2) NOT NULL DEFAULT 0,
  eligibility_status       TEXT NOT NULL DEFAULT 'eligible',
  eligibility_details      TEXT DEFAULT '{}',
  calculation_details      TEXT DEFAULT '{}',
  approval_status          TEXT NOT NULL DEFAULT 'pending'
                             CHECK (approval_status IN
                               ('pending','submitted','manager_approved','finance_approved',
                                'hr_approved','rejected','locked')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kpi_results (
  id                  TEXT PRIMARY KEY,
  payout_id           TEXT NOT NULL REFERENCES employee_payouts(id) ON DELETE CASCADE,
  kpi_id              TEXT NOT NULL REFERENCES kpi_definitions(id),
  target_value        NUMERIC(18,4) NOT NULL DEFAULT 0,
  actual_value        NUMERIC(18,4) NOT NULL DEFAULT 0,
  achievement_percent NUMERIC(10,4) NOT NULL DEFAULT 0,
  slab_rate           NUMERIC(14,4) NOT NULL DEFAULT 0,
  slab_type           TEXT,
  raw_payout          NUMERIC(14,2) NOT NULL DEFAULT 0,
  weighted_payout     NUMERIC(14,2) NOT NULL DEFAULT 0,
  weight              NUMERIC(7,2) NOT NULL DEFAULT 0,
  calculation_details TEXT DEFAULT '{}'
);

-- ---------------------------------------------------------------------
-- Workflow + audit
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_log (
  id            TEXT PRIMARY KEY,
  payout_id     TEXT NOT NULL REFERENCES employee_payouts(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN
                  ('submitted','manager_approved','finance_approved',
                   'hr_approved','rejected','locked')),
  acted_by      TEXT NOT NULL,
  acted_by_role TEXT,
  comments      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_trail (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  changes      TEXT DEFAULT '{}',
  performed_by TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulation_snapshots (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES calculation_runs(id) ON DELETE CASCADE,
  name       TEXT,
  params     TEXT NOT NULL DEFAULT '{}',
  results    TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Event-based triggers (§5)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_events (
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  reference_id    TEXT,
  reference_type  TEXT,
  value           NUMERIC(18,4) DEFAULT 0,
  metadata        TEXT DEFAULT '{}',
  event_date      DATE NOT NULL,
  period          TEXT NOT NULL,
  validated       INTEGER DEFAULT 0,
  validation_notes TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Perfect Store composite scoring (§15)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perfect_store_audits (
  id                         TEXT PRIMARY KEY,
  employee_id                TEXT NOT NULL REFERENCES employees(id),
  customer_id                TEXT NOT NULL REFERENCES customers(id),
  period                     TEXT NOT NULL,
  assortment_score           NUMERIC(7,4) DEFAULT 0,
  pricing_score              NUMERIC(7,4) DEFAULT 0,
  shelf_share_score          NUMERIC(7,4) DEFAULT 0,
  promotion_score            NUMERIC(7,4) DEFAULT 0,
  visibility_score           NUMERIC(7,4) DEFAULT 0,
  cleanliness_score          NUMERIC(7,4) DEFAULT 0,
  stock_availability_score   NUMERIC(7,4) DEFAULT 0,
  composite_score            NUMERIC(7,4) DEFAULT 0,
  audited_by                 TEXT,
  audited_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS perfect_store_weights (
  id                          TEXT PRIMARY KEY,
  plan_id                     TEXT REFERENCES commission_plans(id) ON DELETE CASCADE,
  assortment_weight           NUMERIC(7,2) DEFAULT 20,
  pricing_weight              NUMERIC(7,2) DEFAULT 15,
  shelf_share_weight          NUMERIC(7,2) DEFAULT 15,
  promotion_weight            NUMERIC(7,2) DEFAULT 15,
  visibility_weight           NUMERIC(7,2) DEFAULT 15,
  cleanliness_weight          NUMERIC(7,2) DEFAULT 10,
  stock_availability_weight   NUMERIC(7,2) DEFAULT 10
);

-- ---------------------------------------------------------------------
-- Tagging engine (§22.8)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL CHECK (category IN ('product','customer','territory','employee','transaction')),
  color       TEXT DEFAULT '#6366f1',
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entity_tags (
  id          TEXT PRIMARY KEY,
  tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  valid_from  DATE,
  valid_to    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tag_id, entity_type, entity_id)
);

-- ---------------------------------------------------------------------
-- Multi-currency (§23)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS currencies (
  code    TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  symbol  TEXT,
  is_base INTEGER DEFAULT 0,
  country TEXT
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id              TEXT PRIMARY KEY,
  from_currency   TEXT NOT NULL REFERENCES currencies(code),
  to_currency     TEXT NOT NULL REFERENCES currencies(code),
  rate            NUMERIC(18,8) NOT NULL,
  effective_date  DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_currency, to_currency, effective_date)
);

-- ---------------------------------------------------------------------
-- Helper trip commission (§6.3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id            TEXT PRIMARY KEY,
  trip_number   TEXT,
  trip_date     DATE NOT NULL,
  trip_end_date DATE,
  days_count    INTEGER DEFAULT 1,
  period        TEXT NOT NULL,
  territory_id  TEXT REFERENCES territories(id),
  status        TEXT NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('planned','in_progress','completed','cancelled')),
  distance_km   NUMERIC(10,2) DEFAULT 0,
  stops_count   INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trip_participants (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  employee_id  TEXT NOT NULL REFERENCES employees(id),
  role_on_trip TEXT DEFAULT 'helper',
  UNIQUE (trip_id, employee_id)
);

CREATE TABLE IF NOT EXISTS helper_trip_rates (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT REFERENCES commission_plans(id) ON DELETE CASCADE,
  team_size       INTEGER NOT NULL,
  rate_per_person NUMERIC(10,2) NOT NULL,
  currency        TEXT DEFAULT 'AED',
  UNIQUE (plan_id, team_size)
);

CREATE TABLE IF NOT EXISTS employee_territory_history (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  territory_id    TEXT NOT NULL REFERENCES territories(id),
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  transfer_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_employees_role         ON employees(role_id);
CREATE INDEX IF NOT EXISTS idx_employees_territory    ON employees(territory_id);
CREATE INDEX IF NOT EXISTS idx_transactions_employee  ON transactions(employee_id);
CREATE INDEX IF NOT EXISTS idx_transactions_period    ON transactions(period);
CREATE INDEX IF NOT EXISTS idx_transactions_type      ON transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_plan_kpis_plan         ON plan_kpis(plan_id);
CREATE INDEX IF NOT EXISTS idx_kpi_ded_rules_plan     ON kpi_deduction_rules(plan_id);
CREATE INDEX IF NOT EXISTS idx_kpi_ded_rules_kpi      ON kpi_deduction_rules(kpi_id);
CREATE INDEX IF NOT EXISTS idx_kpi_ded_rules_role     ON kpi_deduction_rules(role_id);
CREATE INDEX IF NOT EXISTS idx_slab_tiers_set         ON slab_tiers(slab_set_id);
CREATE INDEX IF NOT EXISTS idx_slab_sets_role         ON slab_sets(role_id);
CREATE INDEX IF NOT EXISTS idx_monthly_targets_pp     ON plan_kpi_monthly_targets(plan_id, period);
CREATE INDEX IF NOT EXISTS idx_fixed_inc_pp           ON plan_fixed_incentives(plan_id, period);
CREATE INDEX IF NOT EXISTS idx_rules_set              ON rules(rule_set_id);
CREATE INDEX IF NOT EXISTS idx_emp_payouts_run        ON employee_payouts(run_id);
CREATE INDEX IF NOT EXISTS idx_emp_payouts_emp        ON employee_payouts(employee_id);
CREATE INDEX IF NOT EXISTS idx_kpi_results_payout     ON kpi_results(payout_id);
CREATE INDEX IF NOT EXISTS idx_approval_log_payout    ON approval_log(payout_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_entity     ON audit_trail(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_emp_period      ON commission_events(employee_id, period);
CREATE INDEX IF NOT EXISTS idx_events_type            ON commission_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ps_audits_emp_period   ON perfect_store_audits(employee_id, period);
CREATE INDEX IF NOT EXISTS idx_entity_tags_lookup     ON entity_tags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_tags_tag        ON entity_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_emp_terr_history_emp   ON employee_territory_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_trips_period           ON trips(period);
CREATE INDEX IF NOT EXISTS idx_trip_part_emp          ON trip_participants(employee_id);
CREATE INDEX IF NOT EXISTS idx_trip_part_trip         ON trip_participants(trip_id);
CREATE INDEX IF NOT EXISTS idx_helper_rates_plan      ON helper_trip_rates(plan_id);
