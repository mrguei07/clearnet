import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_PALETTE, findIndustry } from '../constants/industries';

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
}

export interface Theme {
  palette: Palette;
  industryCode: string | null;
  industryLabel: string | null;
}

const ThemeContext = createContext<Theme>({
  palette: DEFAULT_PALETTE,
  industryCode: null,
  industryLabel: null,
});

interface Props {
  industryCode?: string | null;
  children: ReactNode;
}

/**
 * Thème dynamique sectoriel (V1.3) : la palette change selon le secteur de
 * l'utilisateur (Maritime = Bleu Océan, Spatial = Violet/Gris, Biotech = Vert…).
 * Défaut = palette Supply Chain (aucune régression si l'utilisateur n'a pas
 * de secteur renseigné).
 */
export function ThemeProvider({ industryCode, children }: Props) {
  const value = useMemo<Theme>(() => {
    const meta = findIndustry(industryCode);
    return {
      palette: meta?.palette ?? DEFAULT_PALETTE,
      industryCode: meta?.code ?? null,
      industryLabel: meta?.label ?? null,
    };
  }, [industryCode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
