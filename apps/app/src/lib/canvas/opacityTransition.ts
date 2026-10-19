import Konva from 'konva'

/** Avoid scheduling animation frames and layer redraws for unchanged opacity. */
export function tweenCanvasOpacity(node: Konva.Node, opacity: number, duration: number) {
  // Tween interpolation can leave the final value one floating-point step away.
  if (Math.abs(node.opacity() - opacity) <= Number.EPSILON) return
  const tween = new Konva.Tween({ node, opacity, duration })
  tween.play()
  return () => tween.destroy()
}
