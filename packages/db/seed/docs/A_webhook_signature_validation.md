# Webhook Signature Validation

_Tenant: Acme Industrial (`A`) · Type: reference_

Acme Industrial signs outbound webhooks with HMAC-SHA256 using a secret shared at subscription creation.

Receivers compute the HMAC of the raw request body with the shared secret and compare it against the X-acmeindustrial-Signature header in constant time to prevent timing attacks.

The X-acmeindustrial-Timestamp header is included to allow replay-window enforcement (recommended: reject requests older than 5 minutes).
