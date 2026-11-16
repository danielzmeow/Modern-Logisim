import { describe, expect, it } from 'vitest';
import { sanitizeProject } from './project';
import { saveProjectToStorage, loadSavedProject, takeStorageNotice, autosaveIsBlocked, type ProjectData } from './store';
import { createComp } from '../model/specs';
import type { Doc } from '../model/types';

function baseDoc(name = 'Main'): Doc {
  const input = createComp('input', { x: 0, y: 0 });
  input.attrs.label = 'A';
  return { version: 1, name, comps: [input], wires: [] };
}

describe('project sanitization', () => {
  it('drops unknown components and invalid wires instead of trusting JSON', () => {
    const doc = baseDoc();
    doc.comps.push({ ...createComp('and', { x: 100, y: 0 }), id: doc.comps[0].id });
    (doc.comps as unknown[]).push({ id: 'bad', kind: 'not-real', at: { x: 0, y: 0 } });
    doc.wires.push(
      { id: 'diagonal', a: { x: 0, y: 0 }, b: { x: 20, y: 20 } },
      { id: 'zero', a: { x: 10, y: 10 }, b: { x: 10, y: 10 } },
      { id: 'ok', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    );
    doc.comps[0].attrs.bits = 99;

    const result = sanitizeProject({ current: 'main', circuits: { main: doc }, order: [] }, 'en');
    expect(result).not.toBeNull();
    expect(result!.project.order).toEqual(['main']);
    expect(result!.project.circuits.main.comps).toHaveLength(2);
    expect(new Set(result!.project.circuits.main.comps.map((c) => c.id)).size).toBe(2);
    expect(result!.project.circuits.main.comps[0].attrs.bits).toBe(32);
    expect(result!.project.circuits.main.wires.map((w) => w.id)).toEqual(['ok']);
    expect(result!.warnings.join(' ')).toContain('unrecognized');
    expect(result!.warnings.join(' ')).toContain('invalid wire');
  });

  it('repairs missing order and current ids and reports missing subcircuits', () => {
    const doc = baseDoc();
    const sub = createComp('sub', { x: 0, y: 0 });
    sub.attrs.circuit = 'missing';
    doc.comps.push(sub);
    const result = sanitizeProject(
      { current: 'gone', circuits: { one: doc }, order: ['gone'] },
      'en',
    );
    expect(result!.project.current).toBe('one');
    expect(result!.project.order).toEqual(['one']);
    expect(result!.warnings.join(' ')).toContain('missing');
  });

  it('accepts a legacy single-document payload', () => {
    const result = sanitizeProject(baseDoc('Legacy'), 'en');
    expect(result!.project.current).toBe('main');
    expect(result!.project.circuits.main.name).toBe('Legacy');
  });

  it('accepts the wrapped payload written by Save Copy', () => {
    const project = {
      current: 'main',
      circuits: { main: baseDoc('Saved copy') },
      order: ['main'],
    };
    const result = sanitizeProject({ app: 'logisim-studio', version: 2, project, doc: baseDoc() }, 'en');
    expect(result!.project.circuits.main.name).toBe('Saved copy');
  });

  it('rejects shapes with no usable circuit', () => {
    expect(sanitizeProject({ circuits: { bad: { comps: 'nope' } } }, 'en')).toBeNull();
    expect(sanitizeProject(null, 'en')).toBeNull();
  });
});

class MemoryStorage {
  values = new Map<string, string>();
  throwOnWrite = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.throwOnWrite) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
}

describe('autosave storage', () => {
  it('keeps the previous payload as a backup when overwriting', () => {
    const storage = new MemoryStorage();
    const first: ProjectData = {
      current: 'main',
      circuits: { main: baseDoc('First') },
      order: ['main'],
    };
    const second: ProjectData = {
      current: 'main',
      circuits: { main: baseDoc('Second') },
      order: ['main'],
    };
    expect(saveProjectToStorage(first, storage).ok).toBe(true);
    expect(saveProjectToStorage(second, storage).ok).toBe(true);
    const backupKey = [...storage.values.keys()].find((key) => key.endsWith('.backup'));
    expect(backupKey).toBeTruthy();
    expect(storage.values.get(backupKey!)).toContain('First');
  });

  it('reports storage failures instead of claiming a save', () => {
    const storage = new MemoryStorage();
    storage.throwOnWrite = true;
    const result = saveProjectToStorage(
      { current: 'main', circuits: { main: baseDoc() }, order: ['main'] },
      storage,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Quota');
  });

  it('restores the backup when the main payload is corrupt', () => {
    const storage = new MemoryStorage();
    const first: ProjectData = {
      current: 'main',
      circuits: { main: baseDoc('First') },
      order: ['main'],
    };
    const second: ProjectData = {
      current: 'main',
      circuits: { main: baseDoc('Second') },
      order: ['main'],
    };
    saveProjectToStorage(first, storage);
    saveProjectToStorage(second, storage);
    const mainKey = [...storage.values.keys()].find(
      (key) => !key.endsWith('.backup') && !key.endsWith('.at'),
    )!;
    storage.values.set(mainKey, '{broken');
    const loaded = loadSavedProject('en', storage);
    expect(loaded?.circuits.main.name).toBe('First');
    expect(takeStorageNotice()).toContain('backup');
  });

  it('pauses autosave when the only local payload is corrupt', () => {
    const storage = new MemoryStorage();
    storage.values.set('logisim-studio.doc.v1', '{broken');
    expect(loadSavedProject('en', storage)).toBeNull();
    expect(autosaveIsBlocked()).toBe(true);
    expect(takeStorageNotice()).toContain('Autosave is paused');
  });
});
