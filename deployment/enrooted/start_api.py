"""Prepare the single-pod backend and pass PID 1 to CUGA's service supervisor."""

import os
from pathlib import Path
import sys
import time


def main() -> None:
    from cuga.config import settings

    if str(settings.storage.mode).lower() == "prod":
        import psycopg
        from cuga.backend.server.auth.delegated_sessions import SCHEMA

        # PostgreSQL starts concurrently in the demo pod. Initialize the login
        # table before accepting simultaneous first logins on a fresh database.
        deadline = time.monotonic() + 120
        while True:
            try:
                conn = psycopg.connect(str(settings.storage.postgres_url), connect_timeout=3)
                break
            except psycopg.OperationalError:
                if time.monotonic() >= deadline:
                    raise SystemExit("PostgreSQL unavailable after 120 seconds")
                time.sleep(2)
        with conn:
            conn.execute(SCHEMA)
    for directory in ("knowledge", "dbs", "skills", "workspace"):
        (Path("/data") / directory).mkdir(parents=True, exist_ok=True)

    python = sys.executable
    supervisor = Path(__file__).with_name("container_services.py")
    cuga = Path(python).with_name("cuga")
    os.execv(python, [python, str(supervisor), str(cuga), "start", "manager", *sys.argv[1:]])


if __name__ == "__main__":
    main()
