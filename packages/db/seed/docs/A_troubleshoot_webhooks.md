# Troubleshooting: Webhook Delivery

_Tenant: Acme Industrial (`A`) · Type: troubleshooting_

Acme Industrial retries failed webhook deliveries with exponential backoff for up to 24 hours.

Common failure modes: receiver timeout (bump to >10s), signature mismatch (confirm raw body is used in HMAC, not re-serialized JSON — see [[webhook_signature_validation]]), TLS failure (ensure the receiver's cert chain is complete).

Delivery logs are visible in the admin console under Integrations > Webhooks. Each attempt records the response status, response body (first 1KB), and timing.
