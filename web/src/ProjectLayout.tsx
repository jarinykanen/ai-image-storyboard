import type { ReactNode } from 'react';

export type ProjectView = 'concepts' | 'identity' | 'storyboard' | 'settings';

const labels: Record<ProjectView, string> = { concepts: 'Concepts', identity: 'Visual Identity', storyboard: 'Storyboard', settings: 'Settings' };

export function ProjectLayout({ projectTitle, view, onBack, onViewChange, sidebar, children }: { projectTitle: string; view: ProjectView; onBack: () => void; onViewChange: (view: ProjectView) => void; sidebar?: ReactNode; children: ReactNode }) {
  return <div className="project-shell">
    <nav className="global-nav" aria-label="Project navigation">
      <button className="nav-back" onClick={onBack}>← <span>Projects</span></button>
      {(Object.keys(labels) as ProjectView[]).map(item => <button key={item} className={`nav-item ${view === item ? 'active' : ''}`} onClick={() => onViewChange(item)}>{labels[item]}</button>)}
      <div className="project-name">Project: <strong>{projectTitle}</strong></div>
    </nav>
    <div className={`workspace-layout ${sidebar ? '' : 'no-sidebar'}`}>
      {sidebar && <aside className="workspace-sidebar">{sidebar}</aside>}
      <main className="workspace-main">{children}</main>
    </div>
  </div>;
}

export function WorkspaceHeader({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <header className="workspace-header"><div><h1>{title}</h1>{description && <div className="workspace-description">{description}</div>}{children}</div>{actions && <div className="workspace-actions">{actions}</div>}</header>;
}
