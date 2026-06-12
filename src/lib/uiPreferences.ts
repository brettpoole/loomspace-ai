export type ThemeMode = 'auto' | 'light' | 'dark';

export interface TtsSettings {
  voiceURI: string;
  rate: number;
}

export interface PanelSizes {
  left: number;
  right: number;
  bottom: number;
}

export interface PanelBounds {
  minPanelWidth: number;
  minCanvasWidth: number;
  minBottomHeight: number;
  maxBottomHeight: number;
}

const PANEL_SIZE_KEY = 'loomspace.panels.v1';
const THEME_MODE_KEY = 'loomspace.theme.v1';
const TTS_SETTINGS_KEY = 'loomspace.tts.v1';
const ONBOARDING_SESSION_KEY = 'loomspace.onboarding.dismissed.v1';

export class BrowserUiPreferences {
  loadThemeMode(): ThemeMode {
    const stored = this.readLocalStorage(THEME_MODE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
  }

  saveThemeMode(mode: ThemeMode) {
    this.writeLocalStorage(THEME_MODE_KEY, mode);
  }

  resolveThemeMode(mode: ThemeMode): 'light' | 'dark' {
    if (mode !== 'auto') return mode;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  loadTtsSettings(): TtsSettings {
    try {
      const raw = this.readLocalStorage(TTS_SETTINGS_KEY);
      if (!raw) return { voiceURI: '', rate: 1 };
      const parsed = JSON.parse(raw) as Partial<TtsSettings>;
      return {
        voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : '',
        rate: this.clamp(Number(parsed.rate) || 1, 0.75, 1.35),
      };
    } catch {
      return { voiceURI: '', rate: 1 };
    }
  }

  saveTtsSettings(settings: TtsSettings) {
    this.writeLocalStorage(TTS_SETTINGS_KEY, JSON.stringify(settings));
  }

  loadPanelSizes(bounds: PanelBounds): PanelSizes {
    const fallback = { left: 300, right: 480, bottom: 260 };
    try {
      const raw = this.readLocalStorage(PANEL_SIZE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<PanelSizes>;
      return {
        left: this.clamp(Number(parsed.left) || fallback.left, bounds.minPanelWidth, this.maxSideWidth(bounds)),
        right: this.clamp(Number(parsed.right) || fallback.right, bounds.minPanelWidth, this.maxSideWidth(bounds)),
        bottom: this.clamp(Number(parsed.bottom) || fallback.bottom, bounds.minBottomHeight, bounds.maxBottomHeight),
      };
    } catch {
      return fallback;
    }
  }

  savePanelSizes(panelSizes: PanelSizes) {
    this.writeLocalStorage(PANEL_SIZE_KEY, JSON.stringify(panelSizes));
  }

  isOnboardingDismissed(): boolean {
    try {
      return sessionStorage.getItem(ONBOARDING_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }

  dismissOnboarding() {
    try {
      sessionStorage.setItem(ONBOARDING_SESSION_KEY, '1');
    } catch {
      // Ignore storage failures.
    }
  }

  cleanTextForSpeech(text: string) {
    return text
      .replace(/```(\w+)?\n[\s\S]*?```/g, (_, lang) => ` Code block${lang ? ` in ${lang}` : ''}. `)
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' image ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  splitTextForSpeech(text: string, maxLength = 220) {
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
    const chunks: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      const next = `${current}${current ? ' ' : ''}${sentence.trim()}`.trim();
      if (next.length <= maxLength) {
        current = next;
        continue;
      }
      if (current) chunks.push(current);
      if (sentence.length <= maxLength) {
        current = sentence.trim();
        continue;
      }
      for (let i = 0; i < sentence.length; i += maxLength) {
        chunks.push(sentence.slice(i, i + maxLength).trim());
      }
      current = '';
    }
    if (current) chunks.push(current);
    return chunks;
  }

  maxSideWidth(bounds: Pick<PanelBounds, 'minPanelWidth' | 'minCanvasWidth'>, reserved = 0) {
    const viewport = typeof window === 'undefined' ? 1280 : window.innerWidth;
    return Math.max(bounds.minPanelWidth, Math.round(viewport - bounds.minCanvasWidth - reserved));
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private readLocalStorage(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeLocalStorage(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage failures.
    }
  }
}

export const browserUiPreferences = new BrowserUiPreferences();
