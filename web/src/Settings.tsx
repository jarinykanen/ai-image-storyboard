import { useEffect, useState } from 'react';
import { Badge, Button, Paper, PasswordInput, Stack, Text } from '@mantine/core';

const API = 'http://localhost:3001/api';
type Status = 'connected' | 'not_configured' | 'invalid_key' | 'rate_limited' | 'provider_unavailable' | 'error' | 'configured';
type ProviderSettings = { configured: boolean; status: Status; lastSuccessfulTestAt: string | null; capabilities: Record<'textGeneration' | 'imageGeneration' | 'imageEditing' | 'referenceImages', boolean> };
type Settings = Record<'openai' | 'grok', ProviderSettings>;
const label: Record<Status, string> = { connected: 'Connected', not_configured: 'Not configured', invalid_key: 'API key is invalid', rate_limited: 'Rate limit reached', provider_unavailable: 'Temporarily unavailable', error: 'Connection error', configured: 'Configured — test connection' };

export function SettingsPage({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<Record<'openai' | 'grok', string>>({ openai: '', grok: '' });
  const [busy, setBusy] = useState<'openai' | 'grok' | null>(null); const [message, setMessage] = useState('');
  const load = async () => { const response = await fetch(`${API}/settings/providers`); const registry = await response.json(); setSettings(registry.providers); };
  useEffect(() => { void load(); }, []);
  const run = async (provider: 'openai' | 'grok', action: 'save' | 'test' | 'remove') => { setBusy(provider); setMessage(''); try {
    const response = await fetch(`${API}/settings/providers/${provider}${action === 'test' ? '/test' : ''}`, action === 'save' ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: keys[provider] }) } : { method: action === 'remove' ? 'DELETE' : 'POST' });
    const payload = response.status === 204 ? null : await response.json(); if (!response.ok) throw new Error(payload?.error || 'Could not update provider settings.');
    setKeys(old => ({ ...old, [provider]: '' })); await load(); setMessage(action === 'save' ? 'Key saved. Test the connection to confirm it works.' : action === 'test' ? 'Connection successful.' : 'Key removed.');
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update provider settings.'); } finally { setBusy(null); } };
  return <><header className="workspace-header"><div><h1>Settings</h1><p>Connect the AI providers used to create your music video.</p></div></header>{message && <Paper className="notice" p="sm">{message}</Paper>}<Paper className="panel settings-panel" p="lg"><h2>AI Providers</h2>{(['openai', 'grok'] as const).map(provider => { const current = settings?.[provider]; const name = provider === 'openai' ? 'OpenAI' : 'xAI / Grok'; return <article className="provider-card" key={provider}><Stack><h3>{name}</h3><PasswordInput label="API key" autoComplete="new-password" value={keys[provider]} placeholder={current?.configured ? '••••••••••••••••' : 'Enter API key'} onChange={event => setKeys(old => ({ ...old, [provider]: event.target.value }))}/><Text>Status: <Badge color={current?.configured ? 'studio' : 'gray'}>{current ? label[current.status] : 'Loading…'}</Badge></Text><div className="card-actions"><Button loading={busy === provider} disabled={!keys[provider].trim()} onClick={() => void run(provider, 'save').then(onSaved)}>{current?.configured ? 'Update key' : 'Save key'}</Button><Button variant="default" loading={busy === provider} disabled={!current?.configured} onClick={() => void run(provider, 'test')}>Test connection</Button>{current?.configured && <Button color="red" loading={busy === provider} onClick={() => void run(provider, 'remove').then(onSaved)}>Remove</Button>}</div></Stack></article>; })}</Paper></>;
}
