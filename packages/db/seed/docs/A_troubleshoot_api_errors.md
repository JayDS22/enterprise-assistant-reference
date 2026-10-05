# Troubleshooting: API Errors

_Tenant: Acme Industrial (`A`) · Type: troubleshooting_

Acme Industrial's API returns standard HTTP status codes. 401 indicates an invalid or expired API key; rotate via the admin console (see [[key_rotation_procedure]]).

429 indicates rate-limit saturation; refer to [[api_rate_limits]] and implement exponential backoff. 5xx indicates a server-side issue; retry with jitter and check the status page.

Validation errors (400) include a machine-readable error code in the response body. Match on the code, not the English message, since messages may be localized.
