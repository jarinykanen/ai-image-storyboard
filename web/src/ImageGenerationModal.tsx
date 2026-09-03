import { useEffect, useState, type ReactNode } from 'react';
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';

export type ImageQuality = 'draft' | 'standard' | 'best';

const qualityOptions = [
  { value: 'draft', label: 'Draft (cheapest)' },
  { value: 'standard', label: 'Standard' },
  { value: 'best', label: 'Final (highest quality)' },
];
const tierFor = (quality: ImageQuality) => quality === 'best' ? 'FINAL' : quality === 'standard' ? 'STANDARD' : 'DRAFT';
type Estimate = { count:number; tier:string; provider:string; model:string; quality:string; resolution:string; estimatedCostUsd:number|null; costUncertain:boolean };

export function ImageGenerationModal({ opened, title, message, confirmLabel, defaultQuality = 'draft', fixedQuality = false, projectId, imageCount = 1, shotIds, loading, confirmDisabled, children, onCancel, onConfirm }: {
  opened: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  defaultQuality?: ImageQuality;
  fixedQuality?: boolean;
  projectId?: string;
  imageCount?: number;
  shotIds?: string[];
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: (quality: ImageQuality) => void;
}) {
  const [quality, setQuality] = useState<ImageQuality>(defaultQuality);
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  useEffect(() => {
    if (opened) setQuality(defaultQuality);
  }, [opened, defaultQuality]);
  useEffect(() => {
    if (!opened || !projectId) return;
    let cancelled = false;
    void fetch(`http://localhost:3001/api/projects/${projectId}/image-generation-estimate`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ count:imageCount, shotIds, tier:tierFor(quality) }) })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(value => { if (!cancelled) setEstimate(value); })
      .catch(() => { if (!cancelled) setEstimate(null); });
    return () => { cancelled = true; };
  }, [opened, projectId, imageCount, quality, shotIds?.join(',')]);

  return <Modal opened={opened} onClose={onCancel} title={title} centered closeOnClickOutside={!loading} closeOnEscape={!loading}>
    <Stack>
      {children}
      <Select
        label="Generation tier"
        description="Uses the project default unless you change it for this generation."
        value={quality}
        onChange={value => setQuality((value || defaultQuality) as ImageQuality)}
        data={qualityOptions}
        allowDeselect={false}
        disabled={fixedQuality}
      />
      {estimate && <Text size="sm"><b>{estimate.tier}</b> · {estimate.provider === 'openai' ? 'OpenAI' : 'xAI / Grok'} · {estimate.model} · {estimate.quality} · {estimate.resolution}<br/>{estimate.costUncertain ? 'Estimated cost is uncertain because pricing or reference-image input may vary.' : `Estimated cost: $${estimate.estimatedCostUsd?.toFixed(2)}`}{estimate.tier === 'FINAL' && estimate.count >= 5 ? ' Consider iterating in Draft before rendering a larger Final batch.' : ''}</Text>}
      <Text>{message}</Text>
      <Group justify="flex-end">
        <Button variant="default" disabled={loading} onClick={onCancel}>Cancel</Button>
        <Button loading={loading} disabled={confirmDisabled} onClick={() => onConfirm(quality)}>{confirmLabel}</Button>
      </Group>
    </Stack>
  </Modal>;
}
