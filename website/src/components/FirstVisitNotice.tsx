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
        <Text size="sm">
          Please read this instruction carefully before using the download site.
        </Text>
        <List size="sm" spacing="xs">
          <List.Item>本站仅镜像各游戏的官方安装包，不作任何修改；版权归各权利方所有。</List.Item>
          <List.Item>
            点击游戏图标查看可用版本与下载链接；下载会自动跳转到离你最近的节点。
          </List.Item>
          <List.Item>带有 OBB 数据包的游戏需要同时安装 APK 与数据包。</List.Item>
        </List>
        <Button onClick={close} fullWidth>
          关闭
        </Button>
      </Stack>
    </Modal>
  );
}
