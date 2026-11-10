INSERT INTO "AdminPermission" ("key", "module", "description", "isEnabled", "createdAt")
VALUES
  ('contracts.cancel', 'contracts', 'Cancel eligible unfunded contracts', TRUE, CURRENT_TIMESTAMP),
  ('contracts.archive', 'contracts', 'Archive eligible contracts from employer lists', TRUE, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
