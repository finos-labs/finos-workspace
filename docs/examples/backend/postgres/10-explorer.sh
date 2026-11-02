#!/bin/sh
set -eu

password="$EXPLORER_PASSWORD"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v password="$password" <<'SQL'
CREATE ROLE explorer LOGIN PASSWORD :'password';
ALTER ROLE explorer SET default_transaction_read_only = on;
ALTER ROLE explorer SET statement_timeout = '15s';

CREATE SCHEMA demo;

CREATE TABLE demo.regions (
  region text PRIMARY KEY,
  name text NOT NULL
);
INSERT INTO demo.regions VALUES
  ('emea', 'Europe, the Middle East and Africa'),
  ('apac', 'Asia Pacific'),
  ('americas', 'The Americas');

CREATE TABLE demo.monthly_sales (
  month date NOT NULL,
  region text NOT NULL REFERENCES demo.regions,
  units integer NOT NULL,
  revenue numeric(12, 2) NOT NULL,
  PRIMARY KEY (month, region)
);
INSERT INTO demo.monthly_sales
SELECT month::date,
       region,
       units,
       round(units * (18.5 + r.n * 2.25), 2)
FROM generate_series(date '2025-01-01', date '2026-09-01', interval '1 month') AS month,
     (VALUES ('emea', 0), ('apac', 1), ('americas', 2)) AS r(region, n),
     LATERAL (SELECT 100 + ((extract(month FROM month)::int * 17 + r.n * 29) % 60)
                 + (extract(year FROM month)::int - 2025) * 12 AS units) AS u;

CREATE VIEW demo.sales_by_region AS
SELECT r.name AS region, sum(s.units) AS units, sum(s.revenue) AS revenue
FROM demo.monthly_sales s JOIN demo.regions r USING (region)
GROUP BY r.name;

CREATE TABLE demo.trades (
  id integer PRIMARY KEY,
  traded date NOT NULL,
  region text NOT NULL,
  desk text NOT NULL,
  trader text NOT NULL,
  product text NOT NULL,
  currency text NOT NULL,
  quantity integer NOT NULL,
  price numeric(12, 2) NOT NULL,
  notional numeric(16, 2) NOT NULL
);
INSERT INTO demo.trades
SELECT i,
       date '2024-01-01' + (i * 7 % 900),
       (ARRAY['EMEA', 'APAC', 'Americas'])[1 + i % 3],
       (ARRAY['Rates', 'Credit', 'Equities', 'Commodities', 'FX'])[1 + i % 5],
       'Trader ' || lpad((1 + i * 13 % 40)::text, 2, '0'),
       (ARRAY['Swap', 'Bond', 'Option', 'Future', 'Spot', 'Forward', 'Note'])[1 + i % 7],
       (ARRAY['USD', 'EUR', 'GBP', 'JPY'])[1 + i * 3 % 4],
       10 + i * 37 % 990,
       round((20 + (i * 7919 % 48000) / 100.0)::numeric, 2),
       round(((10 + i * 37 % 990) * (20 + (i * 7919 % 48000) / 100.0))::numeric, 2)
FROM generate_series(1, 200000) AS i;
CREATE INDEX trades_traded ON demo.trades (traded);

GRANT USAGE ON SCHEMA demo TO explorer;
GRANT SELECT ON ALL TABLES IN SCHEMA demo TO explorer;
SQL
