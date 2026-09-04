import { Alert, Button, Group, Modal, NumberInput, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { ShotDetailSlider } from './ShotDetailSlider';

export type StoryboardGenerationSettings = {
  shotCount: number;
  detailLevel: number;
};

export function StoryboardGenerationModal({ opened, currentShotCount, loading, onCancel, onConfirm }: {
  opened: boolean;
  currentShotCount: number;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (settings: StoryboardGenerationSettings) => void;
}) {
  const [shotCount, setShotCount] = useState(currentShotCount || 12);
  const [detailLevel, setDetailLevel] = useState(50);
  const replacing = currentShotCount > 0;

  useEffect(() => {
    if (!opened) return;
    setShotCount(currentShotCount || 12);
    setDetailLevel(50);
  }, [opened, currentShotCount]);

  return <Modal opened={opened} onClose={onCancel} title={replacing ? 'Regenerate storyboard?' : 'Generate storyboard?'} size="lg" centered>
    <Stack gap="lg">
      <Text size="sm">Choose the number of text-only shot plans and how much visual detail each shot should contain. This does not generate images.</Text>
      {replacing && <Alert color="red" title="Your current storyboard will be replaced">
        All {currentShotCount} current shots—including manual edits, approvals, and attached image versions—will no longer be part of the storyboard. This cannot be undone.
      </Alert>}
      <NumberInput
        label="Number of shots"
        description="Generate between 1 and 60 shots."
        value={shotCount}
        min={1}
        max={60}
        allowDecimal={false}
        allowNegative={false}
        clampBehavior="strict"
        disabled={loading}
        onChange={value => setShotCount(typeof value === 'number' ? value : 1)}
      />
      <ShotDetailSlider value={detailLevel} disabled={loading} onChange={setDetailLevel}/>
      <Group justify="flex-end" mt="md">
        <Button variant="default" disabled={loading} onClick={onCancel}>Cancel</Button>
        <Button color={replacing ? 'red' : undefined} loading={loading} onClick={() => onConfirm({ shotCount, detailLevel })}>
          {replacing ? `Replace with ${shotCount} shots` : `Generate ${shotCount} shots`}
        </Button>
      </Group>
    </Stack>
  </Modal>;
}
