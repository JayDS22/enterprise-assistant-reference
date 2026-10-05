# API Key Rotation Procedure

_Tenant: Cedar Analytics (`C`) · Type: procedure_

Cedar Analytics enforces rotation of production API keys every 180 days.

The old key continues to function for a 7-day grace window after rotation to allow phased migration. Deprecation emails are sent 14 days and 24 hours before expiry.

Rotation is initiated from the admin console. See [[sso_setup]] for the related SSO signing-key rotation (different cadence).
