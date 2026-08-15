-- Downstream consumer mirrored for dependency-assessment demos.
-- Live Snowflake creates this via demo/seed.sql; keep in sync for PR reviews.
CREATE OR REPLACE VIEW ADE_DEMO.OPS.ORDERS_SUMMARY AS
SELECT
  COUNT(*) AS ORDER_COUNT,
  SUM(ORDER_TOTAL) AS TOTAL_ORDER_TOTAL,
  MAX(ORDER_TS) AS LATEST_ORDER_TS
FROM ADE_DEMO.OPS.ORDERS;
