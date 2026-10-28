import { useEffect } from 'react'
import type { Endpoint, TrunkDevice } from '@/types/schema'
import {
  SOCKET_OVERLAY_PATHS,
  LIGHT_POINT_OVERLAY_PATHS,
  LIGHT_SPOT_OVERLAY_PATHS,
  HVAC_ENERGY_SOURCE_PATHS,
  HVAC_TYPE_OVERLAY_PATHS,
  RELAY_OVERLAY_PATHS,
  SMOKE_DETECTOR_OVERLAY_PATHS,
  TRANSFORMER_OVERLAY_PATHS,
} from '@/lib/symbols'
import { CONVERTER_ARTWORK_PATHS } from '@/lib/converterArtwork'
import { showLightPointDecentralOverlay, showLightPointSafetyOverlay } from '@/lib/lightPointProps'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import { logger } from '@/lib/logger'
import { useArtworkValue } from '../shared/useArtworkValue'

const loggedSitplanSymbolFailures = new Set<string>()

/** Plan artwork preserves the existing retain/clear and uncancelled loading policies. */
export function usePlacementArtwork({
  endpoint,
  themeMode,
  colorOverride,
  baseSvgPath,
  isDirectionalConverter,
  showSwitchOverlay,
  showSwitchOverlayLock,
  switchOverlayPath,
  isLightPoint,
  lightPointProps,
  isTransformer,
  conversionProps,
  isLightSpot,
  lightSpotProps,
  isHvac,
  hvacProps,
  relayProps,
  smokeDetectorProps,
}: {
  endpoint: Endpoint | null
  themeMode: string
  colorOverride: string | undefined
  baseSvgPath: string | null | undefined
  isDirectionalConverter: boolean
  showSwitchOverlay: boolean | undefined
  showSwitchOverlayLock: boolean | undefined
  switchOverlayPath: string | undefined
  isLightPoint: boolean
  lightPointProps: Endpoint['lightPointProps']
  isTransformer: boolean
  conversionProps: TrunkDevice['conversionProps']
  isLightSpot: boolean
  lightSpotProps: Endpoint['lightSpotProps']
  isHvac: boolean
  hvacProps: Endpoint['hvacProps']
  relayProps: Endpoint['relayProps']
  smokeDetectorProps: Endpoint['smokeDetectorProps']
}) {
  const hvacEnergyKey = hvacProps?.energySource ?? 'none'
  const hvacTypeKey = hvacProps?.hvacType ?? 'none'
  const [processedImage, setProcessedImage] = useArtworkValue<HTMLImageElement | null>(
    [baseSvgPath, themeMode, colorOverride],
    null,
    !baseSvgPath
  )
  const [converterDiagonalImage, setConverterDiagonalImage] =
    useArtworkValue<HTMLImageElement | null>(
      [isDirectionalConverter, themeMode, colorOverride],
      null,
      !isDirectionalConverter
    )
  const [converterAcImage, setConverterAcImage] = useArtworkValue<HTMLImageElement | null>(
    [isDirectionalConverter, themeMode, colorOverride],
    null,
    !isDirectionalConverter
  )
  const [converterDcImage, setConverterDcImage] = useArtworkValue<HTMLImageElement | null>(
    [isDirectionalConverter, themeMode, colorOverride],
    null,
    !isDirectionalConverter
  )
  const [overlaySwitchImage, setOverlaySwitchImage] = useArtworkValue<HTMLImageElement | null>(
    [showSwitchOverlay, showSwitchOverlayLock, themeMode, colorOverride],
    null,
    !showSwitchOverlay
  )
  const [overlaySwitchLockImage, setOverlaySwitchLockImage] =
    useArtworkValue<HTMLImageElement | null>(
      [showSwitchOverlay, showSwitchOverlayLock, themeMode, colorOverride],
      null,
      !showSwitchOverlayLock
    )
  const [switchOverlayImage, setSwitchOverlayImage] = useArtworkValue<HTMLImageElement | null>(
    [switchOverlayPath, themeMode, colorOverride],
    null,
    !switchOverlayPath
  )
  const [lightPointSafetyImage, setLightPointSafetyImage] =
    useArtworkValue<HTMLImageElement | null>(
      [
        isLightPoint,
        lightPointProps,
        lightPointProps?.safety,
        lightPointProps?.decentral,
        lightPointProps?.autonomous,
        lightPointProps?.switch1p,
        themeMode,
        colorOverride,
      ],
      null,
      !isLightPoint || !lightPointProps || !showLightPointSafetyOverlay(lightPointProps)
    )
  const [lightPointDecentralImage, setLightPointDecentralImage] =
    useArtworkValue<HTMLImageElement | null>(
      [
        isLightPoint,
        lightPointProps,
        lightPointProps?.safety,
        lightPointProps?.decentral,
        lightPointProps?.autonomous,
        lightPointProps?.switch1p,
        themeMode,
        colorOverride,
      ],
      null,
      !isLightPoint || !lightPointProps || !showLightPointDecentralOverlay(lightPointProps)
    )
  const [lightPointSwitchImage, setLightPointSwitchImage] =
    useArtworkValue<HTMLImageElement | null>(
      [
        isLightPoint,
        lightPointProps,
        lightPointProps?.safety,
        lightPointProps?.decentral,
        lightPointProps?.autonomous,
        lightPointProps?.switch1p,
        themeMode,
        colorOverride,
      ],
      null,
      !isLightPoint || !lightPointProps?.switch1p
    )
  const [lightSpotBeamImage, setLightSpotBeamImage] = useArtworkValue<HTMLImageElement | null>(
    [isLightSpot, lightSpotProps?.beamType, themeMode, colorOverride],
    null,
    !isLightSpot || !lightSpotProps?.beamType || lightSpotProps.beamType === 'none'
  )
  const [transformerSafetyImage, setTransformerSafetyImage] =
    useArtworkValue<HTMLImageElement | null>(
      [
        isTransformer,
        conversionProps?.transformerSafetyType,
        conversionProps?.transformerShortCircuitProtected,
        conversionProps?.transformerProtected,
        themeMode,
        colorOverride,
      ],
      null,
      !isTransformer ||
        (conversionProps?.transformerSafetyType !== 'safety_closed' &&
          conversionProps?.transformerSafetyType !== 'safety_open')
    )
  const [transformerShortcircuitImage, setTransformerShortcircuitImage] =
    useArtworkValue<HTMLImageElement | null>(
      [
        isTransformer,
        conversionProps?.transformerSafetyType,
        conversionProps?.transformerShortCircuitProtected,
        conversionProps?.transformerProtected,
        themeMode,
        colorOverride,
      ],
      null,
      !isTransformer || !conversionProps?.transformerShortCircuitProtected
    )
  const [transformerProtectionImage, setTransformerProtectionImage] =
    useArtworkValue<HTMLImageElement | null>(
      [
        isTransformer,
        conversionProps?.transformerSafetyType,
        conversionProps?.transformerShortCircuitProtected,
        conversionProps?.transformerProtected,
        themeMode,
        colorOverride,
      ],
      null,
      !isTransformer || !conversionProps?.transformerProtected
    )
  const [hvacEnergyImage, setHvacEnergyImage] = useArtworkValue<HTMLImageElement | null>(
    [isHvac, hvacEnergyKey, themeMode, colorOverride],
    null,
    !isHvac ||
      !hvacEnergyKey ||
      hvacEnergyKey === 'none' ||
      !HVAC_ENERGY_SOURCE_PATHS[hvacEnergyKey as keyof typeof HVAC_ENERGY_SOURCE_PATHS]
  )
  const [hvacTypeImage, setHvacTypeImage] = useArtworkValue<HTMLImageElement | null>(
    [isHvac, hvacTypeKey, themeMode, colorOverride],
    null,
    !isHvac ||
      !hvacTypeKey ||
      hvacTypeKey === 'none' ||
      !HVAC_TYPE_OVERLAY_PATHS[hvacTypeKey as keyof typeof HVAC_TYPE_OVERLAY_PATHS]
  )
  const [relayOverlayImage, setRelayOverlayImage] = useArtworkValue<HTMLImageElement | null>(
    [endpoint?.symbol, relayProps?.control, themeMode, colorOverride],
    null,
    endpoint?.symbol !== 'relay' ||
      !RELAY_OVERLAY_PATHS[(relayProps?.control ?? 'standard') as keyof typeof RELAY_OVERLAY_PATHS]
  )
  const [smokeDetectorOverlayImage, setSmokeDetectorOverlayImage] =
    useArtworkValue<HTMLImageElement | null>(
      [endpoint?.symbol, smokeDetectorProps?.type, themeMode, colorOverride],
      null,
      endpoint?.symbol !== 'smoke_detector' ||
        !SMOKE_DETECTOR_OVERLAY_PATHS[
          (smokeDetectorProps?.type ?? 'smoke') as keyof typeof SMOKE_DETECTOR_OVERLAY_PATHS
        ]
    )

  // Load the symbol image and process it for theme (must run unconditionally for Rules of Hooks)
  useEffect(() => {
    if (!baseSvgPath) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(baseSvgPath, isDark, colorOverride)
      .then(setProcessedImage)
      .catch(() => {
        if (!loggedSitplanSymbolFailures.has(baseSvgPath)) {
          loggedSitplanSymbolFailures.add(baseSvgPath)
          logger.warn('Failed to load sitplan symbol (shown once per path):', baseSvgPath)
        }
        setProcessedImage(null)
      })
  }, [baseSvgPath, themeMode, colorOverride, setProcessedImage])

  // Directional converters are composed from the shared base, diagonal, and
  // domain artwork so the situation plan uses the same symbol as the other
  // canvas renderers.
  useEffect(() => {
    if (!isDirectionalConverter) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.diagonal, isDark, colorOverride)
      .then(setConverterDiagonalImage)
      .catch(() => setConverterDiagonalImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.AC, isDark, colorOverride)
      .then(setConverterAcImage)
      .catch(() => setConverterAcImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.DC, isDark, colorOverride)
      .then(setConverterDcImage)
      .catch(() => setConverterDcImage(null))
  }, [
    isDirectionalConverter,
    themeMode,
    colorOverride,
    setConverterDiagonalImage,
    setConverterAcImage,
    setConverterDcImage,
  ])

  // Load socket overlay images when socketProps request them (sitplan)
  useEffect(() => {
    if (!showSwitchOverlay && !showSwitchOverlayLock) {
      return
    }
    const isDark = themeMode === 'dark'
    if (showSwitchOverlay) {
      loadProcessedSymbol(SOCKET_OVERLAY_PATHS.switchOverlay, isDark, colorOverride)
        .then(setOverlaySwitchImage)
        .catch(() => setOverlaySwitchImage(null))
    }
    if (showSwitchOverlayLock) {
      loadProcessedSymbol(SOCKET_OVERLAY_PATHS.switchOverlayLock, isDark, colorOverride)
        .then(setOverlaySwitchLockImage)
        .catch(() => setOverlaySwitchLockImage(null))
    }
  }, [
    showSwitchOverlay,
    showSwitchOverlayLock,
    themeMode,
    colorOverride,
    setOverlaySwitchImage,
    setOverlaySwitchLockImage,
  ])

  // Load switch verklikkerlamp overlay (sitplan)
  useEffect(() => {
    if (!switchOverlayPath) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(switchOverlayPath, isDark, colorOverride)
      .then(setSwitchOverlayImage)
      .catch(() => setSwitchOverlayImage(null))
  }, [switchOverlayPath, themeMode, colorOverride, setSwitchOverlayImage])

  // Load light point overlays (safety, decentral, switch 1p).
  useEffect(() => {
    if (!isLightPoint || !lightPointProps) {
      return
    }
    const isDark = themeMode === 'dark'
    if (showLightPointSafetyOverlay(lightPointProps)) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.safety, isDark, colorOverride)
        .then(setLightPointSafetyImage)
        .catch(() => setLightPointSafetyImage(null))
    }
    if (showLightPointDecentralOverlay(lightPointProps)) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.decentral, isDark, colorOverride)
        .then(setLightPointDecentralImage)
        .catch(() => setLightPointDecentralImage(null))
    }
    if (lightPointProps.switch1p) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.switch1p, isDark, colorOverride)
        .then(setLightPointSwitchImage)
        .catch(() => setLightPointSwitchImage(null))
    }
  }, [
    isLightPoint,
    lightPointProps,
    lightPointProps?.safety,
    lightPointProps?.decentral,
    lightPointProps?.autonomous,
    lightPointProps?.switch1p,
    themeMode,
    colorOverride,
    setLightPointSafetyImage,
    setLightPointDecentralImage,
    setLightPointSwitchImage,
  ])

  // Load transformer overlays (safety type, short‑circuit, protection) – sitplan
  useEffect(() => {
    if (!isTransformer) {
      return
    }
    const isDark = themeMode === 'dark'
    const safetyType = conversionProps?.transformerSafetyType ?? 'none'

    if (safetyType === 'safety_closed') {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.safetyClosed, isDark, colorOverride)
        .then(setTransformerSafetyImage)
        .catch(() => setTransformerSafetyImage(null))
    } else if (safetyType === 'safety_open') {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.safetyOpen, isDark, colorOverride)
        .then(setTransformerSafetyImage)
        .catch(() => setTransformerSafetyImage(null))
    }

    if (conversionProps?.transformerShortCircuitProtected) {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.shortcircuit, isDark, colorOverride)
        .then(setTransformerShortcircuitImage)
        .catch(() => setTransformerShortcircuitImage(null))
    }

    if (conversionProps?.transformerProtected) {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.protection, isDark, colorOverride)
        .then(setTransformerProtectionImage)
        .catch(() => setTransformerProtectionImage(null))
    }
  }, [
    isTransformer,
    conversionProps?.transformerSafetyType,
    conversionProps?.transformerShortCircuitProtected,
    conversionProps?.transformerProtected,
    themeMode,
    colorOverride,
    setTransformerSafetyImage,
    setTransformerShortcircuitImage,
    setTransformerProtectionImage,
  ])

  // Load light spot beam overlay (sitplan)
  useEffect(() => {
    if (!isLightSpot || !lightSpotProps?.beamType || lightSpotProps.beamType === 'none') {
      return
    }
    const path =
      lightSpotProps.beamType === 'straight'
        ? LIGHT_SPOT_OVERLAY_PATHS.straight
        : LIGHT_SPOT_OVERLAY_PATHS.diverging
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(path, isDark, colorOverride)
      .then(setLightSpotBeamImage)
      .catch(() => setLightSpotBeamImage(null))
  }, [isLightSpot, lightSpotProps?.beamType, themeMode, colorOverride, setLightSpotBeamImage])

  // Load HVAC energy source overlays (sitplan)
  useEffect(() => {
    if (!isHvac || !hvacEnergyKey || hvacEnergyKey === 'none') {
      return
    }
    const path = HVAC_ENERGY_SOURCE_PATHS[hvacEnergyKey as keyof typeof HVAC_ENERGY_SOURCE_PATHS]
    if (!path) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(path, isDark, colorOverride)
      .then(setHvacEnergyImage)
      .catch(() => setHvacEnergyImage(null))
  }, [isHvac, hvacEnergyKey, themeMode, colorOverride, setHvacEnergyImage])

  // Load HVAC type overlays (sitplan)
  useEffect(() => {
    if (!isHvac || !hvacTypeKey || hvacTypeKey === 'none') {
      return
    }
    const path = HVAC_TYPE_OVERLAY_PATHS[hvacTypeKey as keyof typeof HVAC_TYPE_OVERLAY_PATHS]
    if (!path) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(path, isDark, colorOverride)
      .then(setHvacTypeImage)
      .catch(() => setHvacTypeImage(null))
  }, [isHvac, hvacTypeKey, themeMode, colorOverride, setHvacTypeImage])

  // Load relay control overlay (sitplan)
  useEffect(() => {
    if (endpoint?.symbol !== 'relay') {
      return
    }
    const controlKey = relayProps?.control ?? 'standard'
    const path = RELAY_OVERLAY_PATHS[controlKey as keyof typeof RELAY_OVERLAY_PATHS]
    if (!path) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(path, isDark, colorOverride)
      .then(setRelayOverlayImage)
      .catch(() => setRelayOverlayImage(null))
  }, [endpoint?.symbol, relayProps?.control, themeMode, colorOverride, setRelayOverlayImage])

  // Load smoke / fire detector overlay (sitplan)
  useEffect(() => {
    if (endpoint?.symbol !== 'smoke_detector') {
      return
    }
    const typeKey = smokeDetectorProps?.type ?? 'smoke'
    const path = SMOKE_DETECTOR_OVERLAY_PATHS[typeKey as keyof typeof SMOKE_DETECTOR_OVERLAY_PATHS]
    if (!path) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(path, isDark, colorOverride)
      .then(setSmokeDetectorOverlayImage)
      .catch(() => setSmokeDetectorOverlayImage(null))
  }, [
    endpoint?.symbol,
    smokeDetectorProps?.type,
    themeMode,
    colorOverride,
    setSmokeDetectorOverlayImage,
  ])

  return {
    processedImage,
    converterDiagonalImage,
    converterAcImage,
    converterDcImage,
    overlaySwitchImage,
    overlaySwitchLockImage,
    switchOverlayImage,
    lightPointSafetyImage,
    lightPointDecentralImage,
    lightPointSwitchImage,
    lightSpotBeamImage,
    transformerSafetyImage,
    transformerShortcircuitImage,
    transformerProtectionImage,
    hvacEnergyImage,
    hvacTypeImage,
    relayOverlayImage,
    smokeDetectorOverlayImage,
  }
}
