---
name: local-pg-utf8
description: Local L3 clusters must be initdb'd with -E UTF8 --locale=C.UTF-8; SQL_ASCII makes Unicode-range CHECKs reject UTF-8 names; L3 files' template DBs persist on a shared cluster
metadata:
  type: feedback
---
GRP-01 (2026-10-20): a default `initdb` here gave SQL_ASCII, and memberships_display_name_check (`!~ '[\u0001-\u001f\u007f-\u009f]'`)
then refused every synthetic name with Ø (continuation bytes 0x80-0x9F): 210 false L3 failures. Re-init with
`-E UTF8 --locale=C.UTF-8` gave 301/301. Also: groups.integration and adapters/groups.integration create
`grp_template`/`groups_template` per container and never drop them (CI discards the container), so on one local
cluster the second run dies in beforeAll ("already exists"). Drop `%template`/`it_%` databases before each run, and
treat a file that failed in beforeAll as INVALID, never SURVIVED (my harness first counted it as a survival).
Related: [[in-memory-mutation]], [[grp01-audit]]
