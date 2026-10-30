"""Loop mode: checks each variant whenever the host says it is due.

The host decides from the variant's check interval (5 minutes to a day, set in the dashboard),
its last check, and "check now" requests, so the downloader only has to poll the work list.
"""

from __future__ import annotations

import logging
import time

from .config import Config
from .host import HostClient, HostError
from .runner import Runner

logger = logging.getLogger(__name__)


def run_forever(config: Config, host: HostClient, runner: Runner) -> None:
    if config.daily_at is not None:
        logger.warning(
            "dailyAt is ignored; set how often each variant is checked in the dashboard")
    host.heartbeat("idle")
    while True:
        try:
            due = [task for task in host.variants() if task.check_due]
            if due:
                runner.run_pass(due)
            else:
                host.heartbeat("idle")
        except HostError as error:
            logger.warning("host unavailable: %s", error)
        except Exception:
            logger.exception("pass crashed, continuing")
        time.sleep(config.poll_seconds)
