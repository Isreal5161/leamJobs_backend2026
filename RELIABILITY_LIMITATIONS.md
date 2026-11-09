# Reliability limitations without schema changes

The current job-alert processor uses bounded keyset pages, a PostgreSQL advisory
lock to prevent overlapping runs, and the existing `lastRunAt` field. A run
does not persist a separate page cursor or checkpoint. If its transaction fails
or is interrupted before commit, the run is retried from the beginning. The
stable `job-alert:<alert-id>:<job-id>` email event key and the existing
`EmailDelivery` uniqueness constraints make queue retries idempotent, but do
not provide resumable page-level continuation. Durable continuation would
require persisted processor checkpoint state and a schema migration.

Email workers claim pending deliveries with a conditional status and
`updatedAt` update. The schema has no claim-owner token or lease generation, so
this does not provide durable ownership for a worker that runs longer than the
stale-processing interval. A recovery worker can retry while the original SMTP
request is still in flight, and an SMTP timeout after provider acceptance can
still make delivery outcome uncertain. Stronger worker leases require schema
support; exactly-once delivery additionally depends on idempotency support from
the email provider.
