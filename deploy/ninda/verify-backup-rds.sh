#!/usr/bin/env bash
set -euo pipefail
exec python3 /opt/ninda-platform/deploy/rds-backup.py verify "$@"
