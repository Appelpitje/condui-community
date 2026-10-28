import { useEffect } from 'react'
import type { Endpoint, PanelGridModuleRef } from '@/types/schema'
import type { ModuleDisplayInfo } from '@/lib/panel/getModuleDisplayInfo'
import {
  DOMOTICA_CONTROL_OVERLAY_PATHS,
  getSwitchDisplaySvgPath,
  getSymbolById,
} from '@/lib/symbols'
import { CONVERTER_ARTWORK_PATHS } from '@/lib/converterArtwork'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import { useArtworkValue } from '../shared/useArtworkValue'

type SymbolPath = { svgPath?: string } | null | undefined
/** Panel artwork retains existing paths while loading and the original uncancelled completions. */
export function useModuleArtwork({
  moduleKind,
  domoticaProps,
  info,
  themeMode,
  isEnergyConversionModule,
  isDirectionalEnergyConversion,
  energySymbolMeta,
  isSelectorSwitchModule,
  rotatingSwitchSymbolMeta,
  spdSymbolPath,
}: {
  moduleKind: PanelGridModuleRef['kind']
  domoticaProps: Endpoint['domoticaProps']
  info: ModuleDisplayInfo
  themeMode: string
  isEnergyConversionModule: boolean
  isDirectionalEnergyConversion: boolean
  energySymbolMeta: SymbolPath
  isSelectorSwitchModule: boolean
  rotatingSwitchSymbolMeta: SymbolPath
  spdSymbolPath: string | null
}) {
  const domoticaMainType = domoticaProps?.mainDeviceType
  const mainPath =
    domoticaMainType === 'switch' && domoticaProps?.mainSwitchSymbol
      ? getSwitchDisplaySvgPath(domoticaProps.mainSwitchSymbol, domoticaProps.mainSwitchProps)
      : domoticaMainType === 'socket' && domoticaProps?.mainSocketSymbol
        ? getSymbolById(domoticaProps.mainSocketSymbol)?.svgPath
        : null
  const [acSymbolImage, setAcSymbolImage] = useArtworkValue<HTMLImageElement | null>(
    [isEnergyConversionModule, themeMode],
    null,
    !isEnergyConversionModule
  )
  const [dcSymbolImage, setDcSymbolImage] = useArtworkValue<HTMLImageElement | null>(
    [isEnergyConversionModule, themeMode],
    null,
    !isEnergyConversionModule
  )
  const [energyDeviceImage, setEnergyDeviceImage] = useArtworkValue<HTMLImageElement | null>(
    [energySymbolMeta?.svgPath, isDirectionalEnergyConversion, isEnergyConversionModule, themeMode],
    null,
    !isEnergyConversionModule || isDirectionalEnergyConversion || !energySymbolMeta?.svgPath
  )
  const [energyBaseImage, setEnergyBaseImage] = useArtworkValue<HTMLImageElement | null>(
    [isDirectionalEnergyConversion, themeMode],
    null,
    !isDirectionalEnergyConversion
  )
  const [energyDiagonalImage, setEnergyDiagonalImage] = useArtworkValue<HTMLImageElement | null>(
    [isDirectionalEnergyConversion, themeMode],
    null,
    !isDirectionalEnergyConversion
  )
  const [rotatingSwitchImage, setRotatingSwitchImage] = useArtworkValue<HTMLImageElement | null>(
    [isSelectorSwitchModule, rotatingSwitchSymbolMeta?.svgPath, themeMode],
    null,
    !isSelectorSwitchModule || !rotatingSwitchSymbolMeta?.svgPath
  )
  const [spdSymbolImage, setSpdSymbolImage] = useArtworkValue<HTMLImageElement | null>(
    [spdSymbolPath, themeMode],
    null,
    !spdSymbolPath
  )
  const [relaySymbolImage, setRelaySymbolImage] = useArtworkValue<HTMLImageElement | null>(
    [info.relay, themeMode],
    null,
    !info.relay
  )
  const [relayControlOverlayImage, setRelayControlOverlayImage] =
    useArtworkValue<HTMLImageElement | null>([info.relay, themeMode], null, !info.relay)
  const [domoticaMainImage, setDomoticaMainImage] = useArtworkValue<HTMLImageElement | null>(
    [
      moduleKind,
      domoticaMainType,
      domoticaProps,
      domoticaProps?.mainSwitchSymbol,
      domoticaProps?.mainSwitchProps,
      domoticaProps?.mainSocketSymbol,
      themeMode,
    ],
    null,
    moduleKind !== 'domotica' || !mainPath
  )
  const [domoticaControlImages, setDomoticaControlImages] = useArtworkValue<
    Partial<Record<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS, HTMLImageElement | null>>
  >([moduleKind, themeMode], {}, moduleKind !== 'domotica')

  // Load AC/DC domain symbols for energy conversion modules (panel view)
  useEffect(() => {
    if (!isEnergyConversionModule) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol('/symbols/energy-conversion/symbol_AC.svg', isDark)
      .then(setAcSymbolImage)
      .catch(() => setAcSymbolImage(null))
    loadProcessedSymbol('/symbols/energy-conversion/symbol_DC.svg', isDark)
      .then(setDcSymbolImage)
      .catch(() => setDcSymbolImage(null))
  }, [isEnergyConversionModule, themeMode, setAcSymbolImage, setDcSymbolImage])

  // Show the actual conversion-device symbol in the center of the panel module.
  useEffect(() => {
    if (!isEnergyConversionModule || isDirectionalEnergyConversion || !energySymbolMeta?.svgPath) {
      return
    }
    loadProcessedSymbol(energySymbolMeta.svgPath, themeMode === 'dark')
      .then(setEnergyDeviceImage)
      .catch(() => setEnergyDeviceImage(null))
  }, [
    energySymbolMeta?.svgPath,
    isDirectionalEnergyConversion,
    isEnergyConversionModule,
    themeMode,
    setEnergyDeviceImage,
  ])

  useEffect(() => {
    if (!isDirectionalEnergyConversion) {
      return
    }
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.base, themeMode === 'dark')
      .then(setEnergyBaseImage)
      .catch(() => setEnergyBaseImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.diagonal, themeMode === 'dark')
      .then(setEnergyDiagonalImage)
      .catch(() => setEnergyDiagonalImage(null))
  }, [isDirectionalEnergyConversion, themeMode, setEnergyBaseImage, setEnergyDiagonalImage])

  useEffect(() => {
    if (!isSelectorSwitchModule || !rotatingSwitchSymbolMeta?.svgPath) {
      return
    }
    loadProcessedSymbol(rotatingSwitchSymbolMeta.svgPath, themeMode === 'dark')
      .then(setRotatingSwitchImage)
      .catch(() => setRotatingSwitchImage(null))
  }, [isSelectorSwitchModule, rotatingSwitchSymbolMeta?.svgPath, themeMode, setRotatingSwitchImage])

  useEffect(() => {
    if (!spdSymbolPath) {
      return
    }
    loadProcessedSymbol(spdSymbolPath, themeMode === 'dark')
      .then(setSpdSymbolImage)
      .catch(() => setSpdSymbolImage(null))
  }, [spdSymbolPath, themeMode, setSpdSymbolImage])

  useEffect(() => {
    if (!info.relay) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(info.relay.symbolPath, isDark)
      .then(setRelaySymbolImage)
      .catch(() => setRelaySymbolImage(null))
    loadProcessedSymbol(info.relay.controlOverlayPath, isDark)
      .then(setRelayControlOverlayImage)
      .catch(() => setRelayControlOverlayImage(null))
  }, [info.relay, themeMode, setRelaySymbolImage, setRelayControlOverlayImage])

  // Load domotica main symbol image for panel modules
  useEffect(() => {
    if (moduleKind !== 'domotica' || !domoticaProps) {
      return
    }
    let path: string | null = null
    if (domoticaMainType === 'switch' && domoticaProps.mainSwitchSymbol) {
      path = getSwitchDisplaySvgPath(domoticaProps.mainSwitchSymbol, domoticaProps.mainSwitchProps)
    } else if (domoticaMainType === 'socket' && domoticaProps.mainSocketSymbol) {
      const sym = getSymbolById(domoticaProps.mainSocketSymbol)
      path = sym?.svgPath ?? null
    }
    if (!path) {
      return
    }
    const isDark = themeMode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setDomoticaMainImage)
      .catch(() => setDomoticaMainImage(null))
  }, [
    moduleKind,
    domoticaMainType,
    domoticaProps,
    domoticaProps?.mainSwitchSymbol,
    domoticaProps?.mainSwitchProps,
    domoticaProps?.mainSocketSymbol,
    themeMode,
    setDomoticaMainImage,
  ])

  // Load domotica control overlay icons (shared SVGs per key) for panel modules
  useEffect(() => {
    if (moduleKind !== 'domotica') {
      return
    }
    const keys: Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS> = [
      'programmed_control',
      'wireless_control',
      'detection_control',
      'button_control',
    ]
    keys.forEach((key) => {
      const path = DOMOTICA_CONTROL_OVERLAY_PATHS[key]
      const isDark = themeMode === 'dark'
      loadProcessedSymbol(path, isDark)
        .then((img) => {
          setDomoticaControlImages((prev) => ({ ...prev, [key]: img }))
        })
        .catch(() => {
          setDomoticaControlImages((prev) => ({ ...prev, [key]: null }))
        })
    })
  }, [moduleKind, themeMode, setDomoticaControlImages])

  return {
    acSymbolImage,
    dcSymbolImage,
    energyDeviceImage,
    energyBaseImage,
    energyDiagonalImage,
    rotatingSwitchImage,
    spdSymbolImage,
    relaySymbolImage,
    relayControlOverlayImage,
    domoticaMainImage,
    domoticaControlImages,
  }
}
