import { Button, Group, Modal, Text } from '@mantine/core';

export function ConfirmModal({ opened, title, message, confirmLabel = 'Confirm', confirmColor, loading, onCancel, onConfirm }: { opened: boolean; title: string; message: string; confirmLabel?: string; confirmColor?: string; loading?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Modal opened={opened} onClose={onCancel} title={title} centered>
    <Text>{message}</Text>
    <Group justify="flex-end" mt="lg"><Button variant="default" disabled={loading} onClick={onCancel}>Cancel</Button><Button color={confirmColor} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></Group>
  </Modal>;
}
