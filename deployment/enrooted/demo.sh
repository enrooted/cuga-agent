#!/bin/sh
set -eu
here=$(CDPATH='' cd -P "$(dirname "$0")" && pwd)
python=${DEMO_PYTHON:-python3}
if [ -z "${DEMO_PYTHON:-}" ] && [ -x "$here/../../.venv/bin/python" ]; then
    python="$here/../../.venv/bin/python"
fi
exec "$python" "$here/demo.py" "$@"
