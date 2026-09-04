import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { ShotDetailSlider } from './ShotDetailSlider';

export function ShotRegenerationModal({ opened, shotTitle, loading, onCancel, onConfirm }: {
  opened: boolean;
  shotTitle: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (detailLevel: number) => void;
}) {
  const [detailLevel, setDetailLevel] = useState(50);

  useEffect(() => {
    if (opened) setDetailLevel(50);
  }, [opened]);

  return <Modal opened={opened} onClose={onCancel} title="Regenerate shot details?" size="lg" centered>
    <Stack gap="lg">
      <Text size="sm">Choose how much visual detail the regenerated shot should contain. This generates text only and does not generate an image.</Text>
      <Alert color="red" title="Current shot details will be replaced">
        The details for “{shotTitle}” will be overwritten. Existing image versions will be kept, but they may no longer match the regenerated shot.
      </Alert>
      <ShotDetailSlider value={detailLevel} disabled={loading} onChange={setDetailLevel}/>
      <Group justify="flex-end" mt="md">
        <Button variant="default" disabled={loading} onClick={onCancel}>Cancel</Button>
        <Button color="red" loading={loading} onClick={() => onConfirm(detailLevel)}>Regenerate shot details</Button>
      </Group>
    </Stack>
  </Modal>;
}
