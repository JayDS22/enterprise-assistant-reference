# Operations troubleshooting v24

_Tenant: Acme Industrial (`A`) · Type: troubleshooting_

This guide walks Acme Industrial's operations responders through the first 15 minutes of a reported issue. It is written for the on-call engineer, not the end user, and assumes access to the production dashboards.

Step 1: confirm the symptom reproduces in a controlled environment. Step 2: check the dashboards for anomalies in the preceding 30 minutes. Step 3: review recent changes in the deployment log, giving particular attention to anything shipped in the last 2 hours.

If the issue appears systemic rather than scoped to a single tenant, escalate per [[data_retention_policy]]. Attach the correlation ID from the audit log so downstream responders can trace the request end-to-end. Record the escalation time in the incident channel.

Common first-15-minute mistakes: assuming a reproduction case covers the full scope, trusting dashboard aggregates that smooth over short spikes, and chasing a plausible-looking cause before ruling out recent deploys. Mitigation: pause and verify before narrowing.

Document findings in the ticket as you go. Even if the issue self-resolves, record what was observed so future responders see the pattern. Self-resolution without a cause identified is treated as unresolved for the purpose of retrospectives.

Hand-off at shift change: the outgoing responder leaves a 3-line status (symptom, last action, next step) pinned in the incident channel. The incoming responder acknowledges before the outgoing responder signs off.
