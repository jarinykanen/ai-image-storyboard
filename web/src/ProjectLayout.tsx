import type { ReactNode } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { AppLayout } from './AppLayout';

export type ProjectView = 'concepts' | 'identity' | 'storyboard' | 'artwork' | 'settings';

const labels: Record<ProjectView, string> = { concepts: 'Concepts', identity: 'Visual Identity', storyboard: 'Storyboard', artwork: 'Artwork', settings: 'General' };

export function ProjectLayout({ projectTitle, view, onBack, onViewChange, sidebar, children }: { projectTitle: string; view: ProjectView; onBack: () => void; onViewChange: (view: ProjectView) => void; sidebar?: ReactNode; children: ReactNode }) {
  const navigation = <Group gap={6} wrap="nowrap"><Button variant="subtle" className="nav-back" onClick={onBack}>← <span>Projects</span></Button>{(Object.keys(labels) as ProjectView[]).map(item => <Button key={item} variant={view === item ? 'light' : 'subtle'} className={`nav-item ${view === item ? 'active' : ''}`} onClick={() => onViewChange(item)}>{labels[item]}</Button>)}</Group>;
  return <AppLayout headerStart={navigation} headerEnd={<Text className="project-name">Project: <strong>{projectTitle}</strong></Text>} sidebar={sidebar}>{children}</AppLayout>;
}
