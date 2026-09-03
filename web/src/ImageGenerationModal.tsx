import { useEffect, useState, type ReactNode } from 'react';
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';

export type ImageQuality = 'draft' | 'standard' | 'best';

const qualityOptions = [
  { value: 'draft', label: 'Draft (cheapest)' },
  { value: 'standard', label: 'Standard' },
  { value: 'best', label: 'Best' },
];

export function ImageGenerationModal({ opened, title, message, confirmLabel, defaultQuality = 'standard', loading, confirmDisabled, children, onCancel, onConfirm }: {
  opened: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  defaultQuality?: ImageQuality;
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: (quality: ImageQuality) => void;
}) {
  const [quality, setQuality] = useState<ImageQuality>(defaultQuality);

  useEffect(() => {
    if (opened) setQuality(defaultQuality);
  }, [opened, defaultQuality]);

  return <Modal opened={opened} onClose={onCancel} title={title} centered closeOnClickOutside={!loading} closeOnEscape={!loading}>
    <Stack>
      {children}
      <Select
        label="Image quality"
        description="Uses the project default unless you change it for this generation."
        value={quality}
        onChange={value => setQuality((value || defaultQuality) as ImageQuality)}
        data={qualityOptions}
        allowDeselect={false}
      />
      <Text>{message}</Text>
      <Group justify="flex-end">
        <Button variant="default" disabled={loading} onClick={onCancel}>Cancel</Button>
        <Button loading={loading} disabled={confirmDisabled} onClick={() => onConfirm(quality)}>{confirmLabel}</Button>
      </Group>
    </Stack>
  </Modal>;
}
