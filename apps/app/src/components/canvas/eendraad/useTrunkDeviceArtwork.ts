import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { DomoticaControlKey, TrunkDevice } from '@/types/schema'
import {
  DOMOTICA_CONTROL_OVERLAY_PATHS,
  getSwitchDisplaySvgPath,
  getSymbolById,
  RELAY_OVERLAY_PATHS,
  SOCKET_OVERLAY_PATHS,
  TRANSFORMER_OVERLAY_PATHS,
} from '@/lib/symbols'
import { CONVERTER_ARTWORK_PATHS } from '@/lib/converterArtwork'
import { loadProcessedSymbol } from '@/lib/symbolImage'

/** Remember source transitions separately from asynchronous completions. In particular,
 * old uncancelled requests may still complete after a source was cleared, as before. */
function useArtworkValue<T>(source: readonly unknown[], initial: T, resetOnChange: boolean) {
  const [state, setState] = useState({ source, value: initial })
  if (source.length !== state.source.length || source.some((value, index) => !Object.is(value, state.source[index]))) {
    setState({ source, value: resetOnChange ? initial : state.value })
  }
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setState((current) => ({
      ...current,
      value: typeof update === 'function' ? (update as (previous: T) => T)(current.value) : update,
    }))
  }, [])
  return [state.value, setValue] as const
}

/** Trunk artwork keeps each loader's existing blank/retain and cancellation policy. */
export function useTrunkDeviceArtwork({ device, renderedSymbolPath, isDirectionalConverter, themeMode }: {
  device: TrunkDevice
  renderedSymbolPath: string | null | undefined
  isDirectionalConverter: boolean
  themeMode: string | undefined
}) {
  const isDark = themeMode === 'dark'
  const isDomoticaDevice = device.symbol === 'domotica'
  const isTransformer = device.symbol === 'transformer'
  const domoticaProps = device.domoticaProps
  const domoticaMainType = domoticaProps?.mainDeviceType
  const domoticaMainSwitchSymbol = domoticaProps?.mainSwitchSymbol
  const domoticaMainSocketSymbol = domoticaProps?.mainSocketSymbol
  const domoticaMainSwitchProps = domoticaProps?.mainSwitchProps
  const mainPath = domoticaMainType === 'switch' && domoticaMainSwitchSymbol
    ? getSwitchDisplaySvgPath(domoticaMainSwitchSymbol, domoticaMainSwitchProps)
    : domoticaMainType === 'socket' && domoticaMainSocketSymbol
      ? getSymbolById(domoticaMainSocketSymbol)?.svgPath ?? null
      : null
  const domoticaMainSocketOverlayPath = domoticaMainType === 'socket'
    ? domoticaProps?.mainSocketProps?.switchOverlayLock
      ? SOCKET_OVERLAY_PATHS.switchOverlayLock
      : domoticaProps?.mainSocketProps?.switchOverlay ? SOCKET_OVERLAY_PATHS.switchOverlay : null
    : null
  const relayOverlayPath = device.symbol === 'relay'
    ? RELAY_OVERLAY_PATHS[device.relayProps?.control ?? 'standard']
    : undefined
  const conversionProps = device.conversionProps

  const [processedImage, setProcessedImage] = useArtworkValue<HTMLImageElement | null>([renderedSymbolPath, isDark], null, false)
  const converterSource = [isDirectionalConverter, isDark]
  const [converterDiagonalImage, setConverterDiagonalImage] = useArtworkValue<HTMLImageElement | null>(converterSource, null, !isDirectionalConverter)
  const [converterAcImage, setConverterAcImage] = useArtworkValue<HTMLImageElement | null>(converterSource, null, !isDirectionalConverter)
  const [converterDcImage, setConverterDcImage] = useArtworkValue<HTMLImageElement | null>(converterSource, null, !isDirectionalConverter)
  const [domoticaControlImages, setDomoticaControlImages] = useArtworkValue<Partial<Record<DomoticaControlKey, HTMLImageElement | null>>>(
    [isDomoticaDevice, themeMode], {}, !isDomoticaDevice
  )
  const [domoticaMainImage, setDomoticaMainImage] = useArtworkValue<HTMLImageElement | null>([
    domoticaMainSocketSymbol, domoticaMainSwitchProps, domoticaMainSwitchSymbol,
    domoticaMainType, isDomoticaDevice, themeMode,
  ], null, !isDomoticaDevice || !mainPath)
  const [domoticaMainSocketOverlayImage, setDomoticaMainSocketOverlayImage] = useArtworkValue<HTMLImageElement | null>(
    [domoticaMainSocketOverlayPath, isDomoticaDevice, themeMode], null, !isDomoticaDevice || !domoticaMainSocketOverlayPath
  )
  const [relayOverlayImage, setRelayOverlayImage] = useArtworkValue<HTMLImageElement | null>([relayOverlayPath, isDark], null, true)
  const transformerSource = [isTransformer, conversionProps?.transformerSafetyType,
    conversionProps?.transformerShortCircuitProtected, conversionProps?.transformerProtected, isDark]
  const safetyType = conversionProps?.transformerSafetyType ?? 'none'
  const [transformerSafetyImage, setTransformerSafetyImage] = useArtworkValue<HTMLImageElement | null>(
    transformerSource, null, !isTransformer || (safetyType !== 'safety_closed' && safetyType !== 'safety_open')
  )
  const [transformerShortcircuitImage, setTransformerShortcircuitImage] = useArtworkValue<HTMLImageElement | null>(
    transformerSource, null, !isTransformer || !conversionProps?.transformerShortCircuitProtected
  )
  const [transformerProtectionImage, setTransformerProtectionImage] = useArtworkValue<HTMLImageElement | null>(
    transformerSource, null, !isTransformer || !conversionProps?.transformerProtected
  )

  useEffect(() => {
    if (!isDomoticaDevice) return
    const keys: Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS> = [
      'programmed_control', 'wireless_control', 'detection_control', 'button_control',
    ]
    keys.forEach((key) => {
      loadProcessedSymbol(DOMOTICA_CONTROL_OVERLAY_PATHS[key], themeMode === 'dark')
        .then((image) => setDomoticaControlImages((previous) => ({ ...previous, [key]: image })))
        .catch(() => setDomoticaControlImages((previous) => ({ ...previous, [key]: null })))
    })
  }, [isDomoticaDevice, themeMode, setDomoticaControlImages])

  useEffect(() => {
    if (!isDomoticaDevice) return
    let path: string | null = null
    if (domoticaMainType === 'switch' && domoticaMainSwitchSymbol) {
      path = getSwitchDisplaySvgPath(domoticaMainSwitchSymbol, domoticaMainSwitchProps)
    } else if (domoticaMainType === 'socket' && domoticaMainSocketSymbol) {
      path = getSymbolById(domoticaMainSocketSymbol)?.svgPath ?? null
    }
    if (!path) return
    loadProcessedSymbol(path, themeMode === 'dark').then(setDomoticaMainImage).catch(() => setDomoticaMainImage(null))
  }, [domoticaMainSocketSymbol, domoticaMainSwitchProps, domoticaMainSwitchSymbol,
    domoticaMainType, isDomoticaDevice, themeMode, setDomoticaMainImage])

  useEffect(() => {
    if (!isDomoticaDevice || !domoticaMainSocketOverlayPath) return
    loadProcessedSymbol(domoticaMainSocketOverlayPath, themeMode === 'dark')
      .then(setDomoticaMainSocketOverlayImage).catch(() => setDomoticaMainSocketOverlayImage(null))
  }, [domoticaMainSocketOverlayPath, isDomoticaDevice, themeMode, setDomoticaMainSocketOverlayImage])

  useEffect(() => {
    if (!renderedSymbolPath) return
    loadProcessedSymbol(renderedSymbolPath, isDark).then(setProcessedImage).catch(() => setProcessedImage(null))
  }, [renderedSymbolPath, isDark, setProcessedImage])

  useEffect(() => {
    if (!isDirectionalConverter) return
    const paths = [
      [CONVERTER_ARTWORK_PATHS.diagonal, setConverterDiagonalImage],
      [CONVERTER_ARTWORK_PATHS.AC, setConverterAcImage],
      [CONVERTER_ARTWORK_PATHS.DC, setConverterDcImage],
    ] as const
    for (const [path, setter] of paths) loadProcessedSymbol(path, isDark).then(setter).catch(() => setter(null))
  }, [isDirectionalConverter, isDark, setConverterDiagonalImage, setConverterAcImage, setConverterDcImage])

  useEffect(() => {
    let active = true
    if (relayOverlayPath) {
      loadProcessedSymbol(relayOverlayPath, isDark)
        .then((image) => { if (active) setRelayOverlayImage(image) })
        .catch(() => { if (active) setRelayOverlayImage(null) })
    }
    return () => { active = false }
  }, [relayOverlayPath, isDark, setRelayOverlayImage])

  useEffect(() => {
    if (!isTransformer) return
    const safety = conversionProps?.transformerSafetyType ?? 'none'
    if (safety === 'safety_closed' || safety === 'safety_open') {
      loadProcessedSymbol(safety === 'safety_closed' ? TRANSFORMER_OVERLAY_PATHS.safetyClosed : TRANSFORMER_OVERLAY_PATHS.safetyOpen, isDark)
        .then(setTransformerSafetyImage).catch(() => setTransformerSafetyImage(null))
    }
    if (conversionProps?.transformerShortCircuitProtected) {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.shortcircuit, isDark)
        .then(setTransformerShortcircuitImage).catch(() => setTransformerShortcircuitImage(null))
    }
    if (conversionProps?.transformerProtected) {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.protection, isDark)
        .then(setTransformerProtectionImage).catch(() => setTransformerProtectionImage(null))
    }
  }, [isTransformer, conversionProps?.transformerSafetyType, conversionProps?.transformerShortCircuitProtected,
    conversionProps?.transformerProtected, isDark, setTransformerSafetyImage, setTransformerShortcircuitImage, setTransformerProtectionImage])

  return { processedImage, converterDiagonalImage, converterAcImage, converterDcImage,
    domoticaControlImages, domoticaMainImage, domoticaMainSocketOverlayImage,
    relayOverlayImage, relayOverlayPath, transformerSafetyImage, transformerShortcircuitImage, transformerProtectionImage }
}
