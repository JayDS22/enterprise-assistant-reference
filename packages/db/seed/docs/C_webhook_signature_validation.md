# Webhook Signature Validation

_Tenant: Cedar Analytics (`C`) · Type: reference_

Cedar Analytics signs outbound webhooks with HMAC-SHA256 using a secret shared at subscription creation.

Receivers compute the HMAC of the raw request body with the shared secret and compare it against the X-cedaranalytics-Signature header in constant time to prevent timing attacks.

The X-cedaranalytics-Timestamp header is included to allow replay-window enforcement (recommended: reject requests older than 5 minutes).
