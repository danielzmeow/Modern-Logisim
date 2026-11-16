import type { CanvasTheme } from '../model/types';

export interface Palette {
  bg: string;
  grid: string;
  gridMajor: string;
  wireLow: string;
  wireHigh: string;
  wireBus: string;
  wireZ: string;
  wireError: string;
  wireWarn: string;
  chipFill: string;
  chipStroke: string;
  gateFill: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentSoft: string;
  accentLine: string;
  shadow: string;
  dot: string;
  ledOff: string;
  selectionFill: string;
  ghostFill: string;
  marquee: string;
}

export const PALETTES: Record<CanvasTheme, Palette> = {
  paper: {
    bg: '#fcfcfe',
    grid: '#e7eaf1',
    gridMajor: '#d2d7e3',
    wireLow: '#9aa6ba',
    wireHigh: '#0d9f74',
    wireBus: '#5b67e8',
    wireZ: '#8b95a8',
    wireError: '#e11d48',
    wireWarn: '#d97706',
    chipFill: '#ffffff',
    chipStroke: '#293044',
    gateFill: '#ffffff',
    text: '#1a2030',
    muted: '#6f7a8e',
    faint: '#aab3c3',
    accent: '#3f63ff',
    accentSoft: 'rgba(63, 99, 255, 0.10)',
    accentLine: 'rgba(63, 99, 255, 0.55)',
    shadow: 'rgba(23, 32, 56, 0.14)',
    dot: '#c9d0dd',
    ledOff: '#eef1f6',
    selectionFill: 'rgba(63, 99, 255, 0.05)',
    ghostFill: 'rgba(63, 99, 255, 0.08)',
    marquee: 'rgba(63, 99, 255, 0.09)',
  },
  graphite: {
    bg: '#0b0e14',
    grid: '#1a2231',
    gridMajor: '#2b374e',
    wireLow: '#5a6984',
    wireHigh: '#2fe0a8',
    wireBus: '#93a2ff',
    wireZ: '#6c7890',
    wireError: '#fb7185',
    wireWarn: '#fbbf24',
    chipFill: '#121823',
    chipStroke: '#cbd4e6',
    gateFill: '#121823',
    text: '#eef2fa',
    muted: '#8d98ad',
    faint: '#5a657a',
    accent: '#93a2ff',
    accentSoft: 'rgba(147, 162, 255, 0.14)',
    accentLine: 'rgba(147, 162, 255, 0.65)',
    shadow: 'rgba(0, 0, 0, 0.45)',
    dot: '#2a3448',
    ledOff: '#1b2331',
    selectionFill: 'rgba(147, 162, 255, 0.07)',
    ghostFill: 'rgba(147, 162, 255, 0.12)',
    marquee: 'rgba(147, 162, 255, 0.12)',
  },
};

export const LED_COLORS: Record<string, string> = {
  emerald: '#10b981',
  sky: '#0ea5e9',
  amber: '#f59e0b',
  rose: '#f43f5e',
  violet: '#8b5cf6',
};

export const UI_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif';
export const MONO_FONT = '"SF Mono", ui-monospace, "Menlo", monospace';
