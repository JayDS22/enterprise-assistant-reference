# Troubleshooting: Data Export Fails

_Tenant: Acme Industrial (`A`) · Type: troubleshooting_

If a data export job never completes at Acme Industrial, check the admin console for the job's status.

Jobs can stall if the source dataset exceeds 10GB; in that case the job is split into chunked exports delivered as separate downloads. Contact support if chunks are missing.

The download URL is signed and expires after 24 hours. Re-trigger the export job if the URL has lapsed; see [[data_export_sop]] for the full procedure.
