/** Round up to half a metre, the safe side for a far-end fault check. */
export function acceptedEstimateLengthM(highM: number): number {
  return Math.ceil(highM * 2) / 2
}
