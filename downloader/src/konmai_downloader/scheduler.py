"""Loop mode: one full pass a day plus a quick pass whenever the dashboard requests a check."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta

from .config import Config
from .host import HostClient, HostError
from .runner import Runner

logger = logging.getLogger(__name__)


def next_daily_run(daily_at: str, now: datetime) -> datetime:
    hour, minute = (int(part) for part in daily_at.split(":"))
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def run_forever(config: Config, host: HostClient, runner: Runner) -> None:
    next_full = next_daily_run(config.daily_at, datetime.now())
    logger.info("next full pass at %s", next_full)
    host.heartbeat("idle")
    while True:
        try:
            if datetime.now() >= next_full:
                runner.run_pass()
                next_full = next_daily_run(config.daily_at, datetime.now())
                logger.info("next full pass at %s", next_full)
            elif any(task.check_requested for task in host.variants()):
                runner.run_pass(only_requested=True)
            else:
                host.heartbeat("idle")
        except HostError as error:
            logger.warning("host unavailable: %s", error)
        except Exception:
            logger.exception("pass crashed, continuing")
        time.sleep(config.poll_seconds)
