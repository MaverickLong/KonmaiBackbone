import pytest
from gpapi.config import DeviceBuilder, getDevicesCodenames

added_devices = ["op_8_pro", "sm_s20_plus", "nothing_p1"]


def test_added_devices_extend_the_upstream_list():
    codenames = getDevicesCodenames()
    assert set(added_devices) <= set(codenames)
    assert {"crackling", "walleye"} <= set(codenames)


@pytest.mark.parametrize("device", added_devices)
def test_added_device_builds_every_request(device):
    builder = DeviceBuilder(device)
    builder.setLocale("ja_JP")
    builder.setTimezone("Asia/Tokyo")
    assert f"device={builder.device['build.device']}" in builder.getUserAgent()
    request = builder.getAndroidCheckinRequest()
    assert request.checkin.build.sdkVersion >= 29
    assert "\\" not in request.checkin.build.id
    assert request.deviceConfiguration.nativePlatform[0] == "arm64-v8a"
