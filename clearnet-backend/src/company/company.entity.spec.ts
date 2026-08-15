import {
  Industry,
  ALL_INDUSTRIES,
  LEGACY_INDUSTRIES,
  EXTENSION_INDUSTRIES,
  isIndustry,
  getIndustries,
} from './company.entity';

describe('Company / Industrie', () => {
  it('expose exactement 15 secteurs (12 hérités + 3 verticales V1.1)', () => {
    expect(Object.keys(Industry).length).toBe(15);
    expect(ALL_INDUSTRIES.length).toBe(15);
  });

  it('préserve strictement les 12 secteurs hérités (rétrocompatibilité)', () => {
    expect(LEGACY_INDUSTRIES).toStrictEqual([
      'SupplyChain',
      'RealEstate',
      'Energy',
      'Banking',
      'Metallurgy',
      'Healthcare',
      'Fashion',
      'IndustrialTextile',
      'Defense',
      'Technology',
      'InternationalTrade',
      'Aviation',
    ]);
  });

  it('ajoute les 3 nouvelles verticales à la fin', () => {
    expect(EXTENSION_INDUSTRIES).toStrictEqual(['Maritime', 'Spatial', 'Biotech']);
    expect(ALL_INDUSTRIES.slice(-3)).toStrictEqual(['Maritime', 'Spatial', 'Biotech']);
  });

  it('valide le garde-fou isIndustry', () => {
    expect(isIndustry('Maritime')).toBe(true);
    expect(isIndustry('Biotech')).toBe(true);
    expect(isIndustry('Inconnu')).toBe(false);
    expect(isIndustry(undefined)).toBe(false);
  });

  it('catalogue complet avec métadonnées pour chaque secteur', () => {
    const catalog = getIndustries();
    expect(catalog.length).toBe(15);
    const extensionEntries = catalog.filter((entry) => entry.version === 'v1.1');
    expect(extensionEntries.map((entry) => entry.industry)).toStrictEqual([
      'Maritime',
      'Spatial',
      'Biotech',
    ]);
    expect(catalog.every((entry) => entry.label && entry.group && entry.description)).toBe(true);
  });
});