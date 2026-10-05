# Data Export Standard Operating Procedure

_Tenant: Bluewave Logistics (`B`) · Type: procedure_

Bluewave Logistics customers can request a full data export from the account settings page.

Exports include customers, tickets, subscriptions, and knowledge base documents owned by the requesting tenant. Nothing from other tenants is included; row-level security guarantees this at the DB layer.

The export job runs asynchronously and emails a signed download URL to the account admin on completion. URLs expire after 24 hours.
