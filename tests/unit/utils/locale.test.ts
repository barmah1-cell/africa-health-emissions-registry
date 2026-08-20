/**
 * Unit tests for locale utility functions.
 *
 * Tests cover:
 * - resolveLocalizedText: preference, fallback, and edge cases
 * - determineDefaultLocale: user-specified vs first-provided logic
 * - isBaseSupportedLocale: membership checks
 * - buildJsonbKeywordMatchDescription: pattern generation
 */

import { describe, it, expect } from 'vitest';
import {
  resolveLocalizedText,
  determineDefaultLocale,
  isBaseSupportedLocale,
  buildJsonbKeywordMatchDescription,
} from '../../../src/utils/locale';

describe('resolveLocalizedText', () => {
  it('returns text in preferred locale when available', () => {
    const text = { en: 'Hospital', fr: 'Hôpital', ar: 'مستشفى' };
    expect(resolveLocalizedText(text, 'fr', 'en')).toBe('Hôpital');
  });

  it('falls back to default locale when preferred locale is not available', () => {
    const text = { en: 'Hospital', fr: 'Hôpital' };
    expect(resolveLocalizedText(text, 'ar', 'en')).toBe('Hospital');
  });

  it('falls back to first available value when neither preferred nor default is available', () => {
    const text = { sw: 'Hospitali', pt: 'Hospital' };
    expect(resolveLocalizedText(text, 'ar', 'en')).toBe('Hospitali');
  });

  it('returns preferred locale even when default locale is also available', () => {
    const text = { en: 'English Name', fr: 'French Name' };
    expect(resolveLocalizedText(text, 'en', 'fr')).toBe('English Name');
  });

  it('returns default locale when no preferred locale is specified', () => {
    const text = { en: 'English Name', fr: 'French Name' };
    expect(resolveLocalizedText(text, undefined, 'fr')).toBe('French Name');
  });

  it('returns first value when neither preferred nor default locale is specified', () => {
    const text = { en: 'English Name', fr: 'French Name' };
    expect(resolveLocalizedText(text)).toBe('English Name');
  });

  it('returns empty string for empty text object', () => {
    expect(resolveLocalizedText({})).toBe('');
  });

  it('returns empty string for null/undefined text', () => {
    expect(resolveLocalizedText(null as unknown as Record<string, string>)).toBe('');
    expect(resolveLocalizedText(undefined as unknown as Record<string, string>)).toBe('');
  });

  it('handles single locale correctly', () => {
    const text = { en: 'Only English' };
    expect(resolveLocalizedText(text, 'en')).toBe('Only English');
    expect(resolveLocalizedText(text, 'fr', 'en')).toBe('Only English');
    expect(resolveLocalizedText(text, 'fr', 'ar')).toBe('Only English');
  });

  it('handles text with many locales (up to 20)', () => {
    const text: Record<string, string> = {};
    const locales = ['en', 'fr', 'ar', 'pt', 'sw', 'am', 'ha', 'ig', 'yo', 'zu',
      'af', 'so', 'ti', 'om', 'mg', 'rw', 'ln', 'kg', 'wo', 'ff'];
    locales.forEach((l, i) => { text[l] = `Name in ${l} (${i})`; });

    expect(resolveLocalizedText(text, 'zu')).toBe('Name in zu (9)');
    expect(resolveLocalizedText(text, 'xx', 'ff')).toBe('Name in ff (19)');
  });
});

describe('determineDefaultLocale', () => {
  it('uses user-specified locale when it exists in names', () => {
    const names = { en: 'Hospital', fr: 'Hôpital' };
    expect(determineDefaultLocale(names, 'fr')).toBe('fr');
  });

  it('falls back to first locale when user-specified locale is not in names', () => {
    const names = { en: 'Hospital', fr: 'Hôpital' };
    expect(determineDefaultLocale(names, 'ar')).toBe('en');
  });

  it('uses first locale when no user-specified locale is provided', () => {
    const names = { fr: 'Hôpital', en: 'Hospital' };
    expect(determineDefaultLocale(names)).toBe('fr');
  });

  it('uses first locale when userSpecified is undefined', () => {
    const names = { ar: 'مستشفى', en: 'Hospital' };
    expect(determineDefaultLocale(names, undefined)).toBe('ar');
  });

  it('returns empty string for empty names object', () => {
    expect(determineDefaultLocale({})).toBe('');
  });

  it('handles single locale correctly', () => {
    const names = { sw: 'Hospitali' };
    expect(determineDefaultLocale(names, 'sw')).toBe('sw');
    expect(determineDefaultLocale(names, 'en')).toBe('sw');
    expect(determineDefaultLocale(names)).toBe('sw');
  });

  it('user-specified locale must exist in names to be used', () => {
    const names = { en: 'Hospital', fr: 'Hôpital', pt: 'Hospital' };
    expect(determineDefaultLocale(names, 'pt')).toBe('pt');
    expect(determineDefaultLocale(names, 'xx')).toBe('en');
  });
});

describe('isBaseSupportedLocale', () => {
  it('returns true for base supported locales', () => {
    expect(isBaseSupportedLocale('en')).toBe(true);
    expect(isBaseSupportedLocale('fr')).toBe(true);
    expect(isBaseSupportedLocale('ar')).toBe(true);
    expect(isBaseSupportedLocale('pt')).toBe(true);
    expect(isBaseSupportedLocale('sw')).toBe(true);
  });

  it('returns false for non-base locales', () => {
    expect(isBaseSupportedLocale('de')).toBe(false);
    expect(isBaseSupportedLocale('es')).toBe(false);
    expect(isBaseSupportedLocale('zh')).toBe(false);
    expect(isBaseSupportedLocale('ja')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBaseSupportedLocale('')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isBaseSupportedLocale('EN')).toBe(false);
    expect(isBaseSupportedLocale('Fr')).toBe(false);
  });
});

describe('buildJsonbKeywordMatchDescription', () => {
  it('generates a lowercase LIKE pattern with wildcards', () => {
    const result = buildJsonbKeywordMatchDescription('Hospital');
    expect(result.pattern).toBe('%hospital%');
  });

  it('handles already lowercase keywords', () => {
    const result = buildJsonbKeywordMatchDescription('clinic');
    expect(result.pattern).toBe('%clinic%');
  });

  it('handles mixed case keywords', () => {
    const result = buildJsonbKeywordMatchDescription('HeAlTh PoSt');
    expect(result.pattern).toBe('%health post%');
  });

  it('handles keywords with special characters', () => {
    const result = buildJsonbKeywordMatchDescription('Hôpital');
    expect(result.pattern).toBe('%hôpital%');
  });

  it('provides a description of the SQL pattern usage', () => {
    const result = buildJsonbKeywordMatchDescription('test');
    expect(result.description).toContain('jsonb_each_text');
    expect(result.description).toContain('LOWER');
    expect(result.description).toContain('LIKE');
  });

  it('handles single character keywords', () => {
    const result = buildJsonbKeywordMatchDescription('A');
    expect(result.pattern).toBe('%a%');
  });
});
