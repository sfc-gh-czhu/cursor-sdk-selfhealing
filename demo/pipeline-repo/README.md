# Tiny pipeline repo for cloud-agent PR demos

Mirror of the SQL used in `demo/seed.sql`.

Point `ADE_TARGET_REPO` at a GitHub remote that contains this tree (or copy these files into your pipeline repo):

```
tasks/load_daily_orders.sql      # intentional bug: selects AMOUNT
views/orders_summary.sql         # downstream ORDERS consumer (dependency assessment)
```

The Task Debugger cloud agent clones this repo, runs object dependency assessment (Task + ORDERS_SUMMARY), patches the Task column to `ORDER_TOTAL`, and opens a PR (`autoCreatePR`). The summary view is noted in blast-radius evidence for human review.
