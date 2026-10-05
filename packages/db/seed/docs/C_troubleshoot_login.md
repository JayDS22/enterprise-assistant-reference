# Troubleshooting: Login Issues

_Tenant: Cedar Analytics (`C`) · Type: troubleshooting_

If you cannot log in to Cedar Analytics, start by confirming you are using the correct workspace URL.

Common causes: SSO signing certificate expired (admin regenerates in the IdP), password reset email filtered by spam (check junk folder), workspace suspended due to overdue invoice (see [[billing_dispute_runbook]]).

If MFA is misconfigured, admins can issue a one-time recovery code from the admin console. The recovery code is single-use and expires in 15 minutes.
