# Billing Dispute Runbook

_Tenant: Cedar Analytics (`C`) · Type: procedure_

A billing dispute at Cedar Analytics is any customer-raised challenge to a specific line item on an invoice.

Step 1: acknowledge receipt within 1 business day. Step 2: pull the audit trail for the disputed charges from the audit log. Step 3: compare against the usage report and apply [[refund_policy]] if applicable.

Chargebacks received from the card network bypass this flow and are handled by finance; the account is paused pending resolution.
