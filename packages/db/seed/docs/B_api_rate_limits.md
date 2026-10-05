# API Rate Limits

_Tenant: Bluewave Logistics (`B`) · Type: reference_

Bluewave Logistics's API enforces per-tenant rate limits via a token-bucket algorithm.

Starter plans: 60 requests/minute burst, 2000 requests/hour sustained. Pro plans: 300/min burst, 10000/hr sustained. Enterprise plans are negotiated and typically start at 1000/min burst.

Exceeding the limit returns HTTP 429 with a Retry-After header. Clients should implement exponential backoff; see [[webhook_signature_validation]] for related client-side best practices.
