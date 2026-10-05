# Compliance reference v5

_Tenant: Acme Industrial (`A`) · Type: reference_

This reference captures Acme Industrial's compliance configuration and operating parameters. It is the authoritative snapshot consulted by on-call responders, auditors, and new hires during onboarding.

Values below reflect the current production configuration and are reviewed on the standard cadence. For historical values, consult the configuration repository. The repository preserves every change along with the author, approver, and justification.

Related: [[acceptable_use_policy]], and the shared engineering runbook. If a parameter is missing or stale, open a correction ticket; this document is treated as source of truth for the compliance function. The ticket is routed to the document owner listed in the metadata.

Default values are chosen to balance throughput, reliability, and cost. Tuning beyond the defaults is permitted but must be documented inline with the rationale. Opaque or unexplained deviations are reverted during the next review cycle.

Changes to these values require a two-person review and an entry in the change log, consistent with Acme Industrial's change management policy. Emergency changes bypass the review and are reconciled within one business day under the retroactive-approval process.

Deprecation policy: parameters marked deprecated are retained for one minor version with a scheduled removal date. Consumers are notified via the standard deprecation channel at least two sprints before removal.
