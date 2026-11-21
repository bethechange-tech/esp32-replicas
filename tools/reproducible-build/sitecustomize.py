"""Makes the ESPHome container's build time a fixed instant, so that a build is reproducible.

ESPHome writes the time of the build into the firmware (`get_build_info` in esphome/writer.py asks
`time.time()`). Only that one call is answered with SOURCE_DATE_EPOCH; every other caller sees real time.
Loaded through PYTHONPATH by tools/build-samples.sh; it changes nothing outside the container.
"""
import os
import sys
import time

_EPOCH = os.environ.get("SOURCE_DATE_EPOCH")
_REAL_TIME = time.time


def _time():
    if _EPOCH is not None and sys._getframe(1).f_code.co_name == "get_build_info":
        return float(_EPOCH)
    return _REAL_TIME()


time.time = _time
