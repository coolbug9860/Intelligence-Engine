/**
 * geminiService.retailNoise.test.ts
 *
 * Verifies the consumer/retail-investor input filter that keeps personal-finance and
 * general-markets noise from seeding B2B syndicated-report opportunities.
 */

import { describe, it, expect } from 'vitest';
import { isRetailNoise } from './articlePreparation';

describe('isRetailNoise — drops consumer/personal-finance noise', () => {
  it.each([
    "I'm 55 and retiring in 6 years. Should I switch to Roth 401(k) contributions?",
    "The best dividend stocks to buy now",
    "How to invest your first $10,000",
    "Mortgage rates climb as buyers retreat",
    "Improve your credit score before applying",
    "Wall Street vs Main Street: who wins?",
    "Student loan forgiveness update",
  ])('flags retail/personal-finance headline: %s', (title) => {
    expect(isRetailNoise(title)).toBe(true);
  });
});

describe('isRetailNoise — preserves legitimate B2B signals', () => {
  it.each([
    "AbbVie nears $21 billion deal for Apogee Therapeutics",
    "TSMC expands Arizona fab capacity for 2nm production",
    "IRA Section 45X tax credit accelerates US solar manufacturing", // Inflation Reduction Act — must NOT be filtered
    "Defense procurement signals shift toward Canadian semiconductors",
    "Grid-scale energy storage deployments surge in Europe",
  ])('keeps B2B headline: %s', (title) => {
    expect(isRetailNoise(title)).toBe(false);
  });

  it('returns false for empty/undefined input', () => {
    expect(isRetailNoise('')).toBe(false);
    expect(isRetailNoise(undefined)).toBe(false);
  });
});
