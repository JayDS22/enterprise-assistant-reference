# Data Retention Policy

_Tenant: Cedar Analytics (`C`) · Type: policy_

Cedar Analytics retains customer production data for the duration of the active subscription plus 90 days after cancellation.

After the 90-day grace period, all production data is purged from primary stores and derived indexes. Backups are retained encrypted for an additional 180 days then rotated out.

Audit logs are retained for 7 years to meet SOC 2 and regional compliance requirements. See [[acceptable_use_policy]] and [[data_export_sop]] for related procedures.

Deletion requests under GDPR Article 17 are honored within 30 days. The deletion endpoint cascades across tickets, subscriptions, and knowledge base contributions tied to the subject.
