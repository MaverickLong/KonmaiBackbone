import { Button, List, Modal, Stack, Text } from '@mantine/core';
import { useState } from 'react';

const storageKey = 'konmai.noticeSeen';

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return true;
  }
}

export function FirstVisitNotice() {
  const [opened, setOpened] = useState(() => !alreadySeen());
  const close = () => {
    try {
      localStorage.setItem(storageKey, 'true');
    } catch {
      // Private mode: the notice simply shows again next time.
    }
    setOpened(false);
  };
  return (
    <Modal opened={opened} onClose={close} title="使用前请阅读" centered>
      <Stack>
        <Text size="sm">请务必仔细阅读本说明后再使用下载站。</Text>
        <List size="sm" spacing="xs">
          <List.Item>
            如无特别说明, 本站游戏包<b>仅适用于安卓/鸿蒙设备</b>。点击对应游戏卡片后,
            点击卡片内的对应版本链接即可下载。
          </List.Item>
          <List.Item>本站不是任何游戏的官方, 也无法解答任何游玩/账号注册等问题。</List.Item>
          <List.Item>带有 OBB 数据包的游戏需要同时安装 APK 与数据包。</List.Item>
        </List>
        <Button onClick={close} fullWidth>
          关闭
        </Button>
      </Stack>
    </Modal>
  );
}
