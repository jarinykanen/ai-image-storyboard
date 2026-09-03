import type { FormEvent } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Textarea, TextInput } from '@mantine/core';

type ImageProvider = 'openai' | 'grok';

type ProjectCreationModalProps = {
  opened: boolean;
  loading: boolean;
  error: string;
  imageProviders: ImageProvider[];
  configuredImageProviders: ImageProvider[];
  defaultImageProvider: ImageProvider;
  onClose: () => void;
  onOpenSettings: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ProjectCreationModal({ opened, loading, error, imageProviders, configuredImageProviders, defaultImageProvider, onClose, onOpenSettings, onSubmit }: ProjectCreationModalProps) {
  const openaiConfigured = configuredImageProviders.includes('openai');
  const grokConfigured = configuredImageProviders.includes('grok');
  const canCreate = openaiConfigured || grokConfigured;

  return <Modal opened={opened} onClose={onClose} title="Create project" size="xl" centered closeOnClickOutside={!loading} closeOnEscape={!loading}>
    <form onSubmit={onSubmit}>
      <Stack gap="md">
        <TextInput name="title" label="Project title" required placeholder="Neon Dreams" autoFocus />
        <Textarea name="lyrics" label="Lyrics (optional)" minRows={6} placeholder="Paste lyrics here…" />
        <Textarea name="sunoDescription" label="SUNO description (optional)" minRows={4} description="This helps the AI understand the song's style, mood, instruments and overall direction." placeholder="Paste the original SUNO song description or prompt here." />
        <Textarea name="visualStyle" label="Visual direction" required minRows={3} placeholder="Describe the kind of video you want: dark cinematic story, dreamy summer road trip, surreal sci-fi, energetic performance video…" />
        <Group grow align="start" className="project-create-options">
          <Select name="aspectRatio" label="Format" defaultValue="16:9" data={['16:9', '9:16', '1:1']} />
          <Select name="imageQualityPreset" label="Image quality" defaultValue="standard" data={[{ value: 'draft', label: 'Draft — cheapest, for storyboard previews' }, { value: 'standard', label: 'Standard — normal quality' }, { value: 'best', label: 'Best — highest quality, higher cost' }]} />
          <Select key={`${defaultImageProvider}-${configuredImageProviders.join('-')}`} name="imageProvider" label="Image provider" defaultValue={defaultImageProvider} disabled={!configuredImageProviders.length} data={imageProviders.map(provider => ({ value: provider, label: `${provider === 'openai' ? 'OpenAI' : 'xAI / Grok'}${!configuredImageProviders.includes(provider) ? ' — Not configured' : ''}`, disabled: !configuredImageProviders.includes(provider) }))} />
        </Group>
        {!canCreate && <Alert color="red">Connect an image provider in <Button type="button" variant="transparent" px={4} onClick={onOpenSettings}>Settings</Button> to create a project.</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button type="button" variant="default" disabled={loading} onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading} disabled={!canCreate}>Create project</Button>
        </Group>
      </Stack>
    </form>
  </Modal>;
}
