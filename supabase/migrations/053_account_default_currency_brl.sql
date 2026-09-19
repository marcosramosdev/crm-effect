-- ============================================================
-- 053_account_default_currency_brl
--
-- Flip the column default on accounts.default_currency from USD to
-- BRL. The product is Brazilian; every new clinic provisioned or
-- signed up from now on should be born quoting deals in Real, not
-- Dollars (openspec change brazilian-formatting).
--
-- Deliberately a column-default change only: no UPDATE, no backfill.
-- An existing account's default_currency is a value already chosen
-- for it — silently rewriting it would reinterpret the value of
-- every deal in that account. Existing accounts keep exactly the
-- currency they hold today, whatever it is.
--
-- The `^[A-Z]{3}$` check from migration 021 is untouched.
-- ============================================================

ALTER TABLE accounts
  ALTER COLUMN default_currency SET DEFAULT 'BRL';
