#!/usr/bin/env bash

set -euo pipefail

pnpm db:migrate:local
pnpm db:seed
exec pnpm dev --host 127.0.0.1 --mode e2e
