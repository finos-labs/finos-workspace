#!/bin/sh
set -eu

password="$(cat /run/secrets/explorer_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v password="$password" <<'SQL'
CREATE ROLE explorer LOGIN PASSWORD :'password';
-- What the plugin's backend enforces anyway, enforced by the database too
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

GRANT USAGE ON SCHEMA demo TO explorer;
GRANT SELECT ON ALL TABLES IN SCHEMA demo TO explorer;
SQL
