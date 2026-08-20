/**
 * Locale utility functions for the Africa Health Facilities Registry.
 *
 * Provides helpers for:
 * - Resolving localized text with preference and fallback logic
 * - Determining the default locale for a facility record
 * - Validating locale support
 *
 * These utilities centralize multilingual logic used across the service layer.
 */

import { SUPPORTED_LOCALES } from '../validation/schemas';
import type { LocalizedText } from '../types/models';

/**
 * The set of base supported locales for validation purposes.
 * Re-exported from validation/schemas for convenience.
 */
export { SUPPORTED_LOCALES };

/**
 * Resolves the best available localized text value given a preference.
 *
 * Resolution order:
 * 1. Preferred locale (if provided and available)
 * 2. Default locale (if provided and available)
 * 3. First available value in the text object
 * 4. Empty string if no values exist
 *
 * @param text - The localized text object (locale keys → string values)
 * @param preferredLocale - Optional locale the user prefers
 * @param defaultLocale - Optional default locale of the record
 * @returns The resolved text string
 */
export function resolveLocalizedText(
  text: LocalizedText,
  preferredLocale?: string,
  defaultLocale?: string,
): string {
  if (!text || typeof text !== 'object') {
    return '';
  }

  const entries = Object.values(text);
  if (entries.length === 0) {
    return '';
  }

  // 1. Try preferred locale
  if (preferredLocale && text[preferredLocale] !== undefined) {
    return text[preferredLocale];
  }

  // 2. Try default locale
  if (defaultLocale && text[defaultLocale] !== undefined) {
    return text[defaultLocale];
  }

  // 3. Fall back to first available value
  return entries[0] ?? '';
}

/**
 * Determines the default locale for a facility record.
 *
 * Logic:
 * - If the user explicitly specifies a default locale AND that locale
 *   exists as a key in the names object, use it.
 * - Otherwise, use the first key in the names object.
 *
 * @param names - The localized names object (must have at least 1 entry)
 * @param userSpecified - Optional locale explicitly chosen by the user
 * @returns The determined default locale string
 */
export function determineDefaultLocale(
  names: LocalizedText,
  userSpecified?: string,
): string {
  const localeKeys = Object.keys(names);

  if (localeKeys.length === 0) {
    return '';
  }

  // If user specified a locale and it exists in the names, use it
  if (userSpecified && localeKeys.includes(userSpecified)) {
    return userSpecified;
  }

  // Otherwise, use the first provided locale
  return localeKeys[0];
}

/**
 * Checks whether a given locale code is in the base supported locales set.
 *
 * Note: The system accepts any valid locale code format (validated by Zod schema),
 * but this function checks against the primary supported set (en, fr, ar, pt, sw).
 *
 * @param locale - The locale code to check
 * @returns true if the locale is in the base supported set
 */
export function isBaseSupportedLocale(locale: string): boolean {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/**
 * Builds a keyword search condition that matches across all locale values
 * in a JSONB column. Used for constructing raw SQL queries against the
 * GIN-indexed names/addresses columns.
 *
 * The function returns the SQL fragment and parameter for use in a raw query.
 * The caller is responsible for parameterized query construction to prevent injection.
 *
 * @param keyword - The search keyword (case-insensitive partial match)
 * @returns An object describing how to match across JSONB locale values
 */
export function buildJsonbKeywordMatchDescription(keyword: string): {
  description: string;
  pattern: string;
} {
  const pattern = `%${keyword.toLowerCase()}%`;
  return {
    description:
      'Match keyword case-insensitively against any locale value in the JSONB column. ' +
      'Use: EXISTS (SELECT 1 FROM jsonb_each_text(column) AS kv WHERE LOWER(kv.value) LIKE pattern)',
    pattern,
  };
}
