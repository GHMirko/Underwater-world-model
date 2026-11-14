import { contourDisplayAssessment } from './contour-quality.js';

/**
 * Cartography must not disappear while an AOI numeric extraction runs.
 * Published EMODnet context contours remain visible where geographically
 * relevant, throughout the AOI lifecycle. They are never upgraded to AOI
 * measurements; an accepted numeric AOI layer is a distinct overlay.
 */
export function contourPresentationPolicy({ aoi, contours, bathyMode, hasRegionalContext, summary }) {
  const enabled = Boolean(contours) && bathyMode !== 'none';
  const assessment = contourDisplayAssessment(summary);
  return {
    contextVisible: enabled && Boolean(hasRegionalContext),
    numericVisible: enabled && Boolean(aoi) && assessment.displayable,
    numericQaAccepted: enabled && Boolean(aoi) && assessment.ready,
    numericAssessment: assessment,
    mode: !enabled ? 'off'
      : !aoi ? (hasRegionalContext ? 'context' : 'unavailable')
      : assessment.ready ? 'aoi-validated'
      : assessment.displayable ? 'aoi-provisional'
      : hasRegionalContext ? 'aoi-context-fallback' : 'aoi-unavailable'
  };
}
