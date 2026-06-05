
import { SignalLedgerEntry, ForecastValidationEntry, ReportSuggestion, IntelligenceProfile } from '../types';

/**
 * KAISO INTELLIGENCE HUB — Temporal Intelligence Engine
 * 
 * PURPOSE:
 * Eliminates structural risks by grounding signals in a time-bucketed ledger
 * and enforcing ground-truth validation for forecasts.
 */

export function runTemporalIntelligence(signals: ReportSuggestion[]): ReportSuggestion[] {
  return signals.map(signal => {
    
    // 1. Time-bucketed Signal Ledger
    // Prevents "Additive Drift" by ensuring signals are tracked as distinct 
    // longitudinal events rather than a single aggregated trust value.
    const ledger: SignalLedgerEntry[] = signal.signalLedger || [];
    const newEntry: SignalLedgerEntry = {
      timestamp: signal.sourceArticleTimestamp,
      intensity: (signal.opportunityScore || 50) / 100,
      evidenceId: signal.id
    };
    
    const dayTimestamp = new Date(newEntry.timestamp).setHours(0,0,0,0);
    const existingIdx = ledger.findIndex(e => new Date(e.timestamp).setHours(0,0,0,0) === dayTimestamp);
    
    if (existingIdx !== -1) {
      // Conservative saturation: only update if new intensity is higher
      ledger[existingIdx].intensity = Math.max(ledger[existingIdx].intensity, newEntry.intensity);
    } else {
      ledger.push(newEntry);
    }
    
    const sortedLedger = ledger.sort((a,b) => a.timestamp - b.timestamp).slice(-30);

    // 2. Forecast Validation (Ground-Truth Strategy)
    // Marks predictions for future verification to prevent "Forecast Hallucination".
    const forecastValidation: ForecastValidationEntry[] = signal.forecastValidation || [];
    
    if (signal.opportunityScore > 75 && forecastValidation.length === 0) {
      forecastValidation.push({
        predictionDate: Date.now(),
        targetDate: Date.now() + (180 * 24 * 60 * 60 * 1000), // 6 month validation
        metricLabel: "Market Adoption",
        predictedValue: signal.opportunityScore,
        isConfirmed: false
      });
    }

    // 3. Temporal Drift Calculation
    const now = Date.now();
    const ageDays = (now - signal.sourceArticleTimestamp) / (1000 * 60 * 60 * 24);
    const temporalDrift = Math.min(1.0, ageDays / 45); // Signal logic decays over 45 days

    const currentProfile: IntelligenceProfile = signal.intelligenceProfile || {
      evidenceWeight: 0.5,
      systemicResilience: 0.5,
      calibrationIntegrity: 0.5,
      groundingDelta: 0.5,
      overallConfidence: 0.5,
      temporalDrift: 0,
      forecastAccuracy: 0.5
    };

    return {
      ...signal,
      signalLedger: sortedLedger,
      forecastValidation: forecastValidation.slice(-5),
      intelligenceProfile: {
        ...currentProfile,
        temporalDrift,
        forecastAccuracy: 0.75 // Default baseline to be evolved by EvolutionEngine
      }
    };
  });
}
