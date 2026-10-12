// Copyright (c) 2026 Zewditu Herring
// SPDX-License-Identifier: MIT OR Apache-2.0

/**
 * Shrink a phone photo before upload so it's fast on mobile data and
 * small in storage. Returns a JPEG Blob no wider/taller than `maxSize`.
 */
export async function shrinkPhoto(file, maxSize = 1600, quality = 0.8) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process photo.'))),
      'image/jpeg', quality)
  })
}

/** Public URL for a cleaning photo in the cleaning-photos bucket. */
export function cleaningPhotoUrl(supabase, path) {
  return supabase.storage.from('cleaning-photos').getPublicUrl(path).data.publicUrl
}
