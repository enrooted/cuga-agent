"""Scope payload suppression to signed-in turns in a delegation-enabled deployment."""

from contextvars import ContextVar
from functools import lru_cache
import re

private_turn = ContextVar("cuga_private_evidence_turn", default=False)


@lru_cache(maxsize=1)
def install_log_redaction():
    from loguru import logger

    def redact(record):
        if private_turn.get():
            message = "Authenticated evidence turn"
            if record["function"] == "log_error_ref" and record["exception"]:
                ref = re.match(r"^\[([a-f0-9]{12})\]", record["message"])
                if ref:
                    error = record["exception"].value
                    message += f" ref={ref[1]} error={type(error).__name__}"
                    tb = error.__traceback__
                    if tb:
                        while tb.tb_next:
                            tb = tb.tb_next
                        message += f" at {tb.tb_frame.f_code.co_name}:{tb.tb_lineno}"
            record["message"] = message
            record["exception"] = None
            record["extra"].clear()

    logger.configure(patcher=redact)
