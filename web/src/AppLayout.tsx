import type { ReactNode } from 'react';
import { AppShell, Paper } from '@mantine/core';

type AppLayoutProps = {
  headerStart: ReactNode;
  headerEnd?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
};

export function AppLayout({ headerStart, headerEnd, sidebar, children }: AppLayoutProps) {
  return <AppShell className="studio-shell" header={{ height: 62 }} padding={0}>
    <AppShell.Header className="global-nav">
      <div className="global-nav-start">{headerStart}</div>
      {headerEnd && <div className="global-nav-end">{headerEnd}</div>}
    </AppShell.Header>
    <AppShell.Main className="app-shell-main">
      <div className={`workspace-layout ${sidebar ? '' : 'no-sidebar'}`}>
        {sidebar && <Paper component="aside" className="workspace-sidebar">{sidebar}</Paper>}
        <main className="workspace-main">{children}</main>
      </div>
    </AppShell.Main>
  </AppShell>;
}

export function WorkspaceHeader({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <header className="workspace-header"><div><h1>{title}</h1>{description && <div className="workspace-description">{description}</div>}{children}</div>{actions && <div className="workspace-actions">{actions}</div>}</header>;
}
