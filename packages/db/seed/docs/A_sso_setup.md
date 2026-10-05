# SSO Setup Guide

_Tenant: Acme Industrial (`A`) · Type: reference_

Acme Industrial supports SAML 2.0 and OIDC for enterprise customers.

The admin creates an SSO application in their identity provider (Okta, Azure AD, Google Workspace, generic SAML), uploads the metadata XML to Acme Industrial's admin console, and maps attribute claims to tenant roles.

SCIM 2.0 is available on the Enterprise plan for automated user provisioning. The signing certificate rotates every 2 years with a 90-day overlap window.
