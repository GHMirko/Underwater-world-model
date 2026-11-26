import { contourDisplayAssessment } from './contour-quality.js';
import { localContoursMatchSource, publishedContextAllowed, sourceSpec } from './bathymetry-source-policy.js';

/**
 * Source-matched visual authority.
 * AUTO retains truthful labelled EMODnet context beneath its numeric AOI.
 * Explicit WCS hides published WFS; explicit WFS hides derived WCS.
 * GEBCO/ENC never fall back silently to EMODnet.
 */
export function contourPresentationPolicy({
  aoi, contours, bathyMode, hasRegionalContext, summary,
  bathymetryGridSource = null, gebcoAvailable = false, coastalAvailable = false
}) {
  const enabled = Boolean(contours) && bathyMode !== 'none';
  const spec = sourceSpec(bathyMode);
  const assessment = contourDisplayAssessment(summary);
  const sourceMatched = localContoursMatchSource(bathyMode,bathymetryGridSource);
  const contextVisible = enabled && publishedContextAllowed(bathyMode,hasRegionalContext);
  const numericVisible = enabled && Boolean(aoi) && sourceMatched && assessment.displayable;
  const numericQaAccepted = numericVisible && assessment.ready;
  const mode = !enabled ? 'off'
    : bathyMode === 'gebco-global' ? (gebcoAvailable ? 'gebco-imported' : 'gebco-await')
    : bathyMode === 'coastal-charts' ? (coastalAvailable ? 'coastal-imported' : 'coastal-await')
    : bathyMode === 'chart-relief' ? 'legacy-disabled'
    : bathyMode === 'emodnet-rainbow' ? (contextVisible ? 'published-only' : 'unavailable')
    : !aoi ? (contextVisible ? 'context' : 'unavailable')
    : numericQaAccepted ? 'aoi-validated'
    : numericVisible ? 'aoi-provisional'
    : contextVisible ? 'aoi-context-fallback' : 'aoi-numeric-unavailable';
  return {
    selected_source:spec.authority,
    contextVisible,
    numericVisible,
    numericQaAccepted,
    numericAssessment:assessment,
    mode
  };
}
