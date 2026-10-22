export const MAX_IMAGES = 12;

// The original single-image products continue to work without migration.
export function photosFor(product) {
  return Array.isArray(product.images) ? [...product.images] : product.image ? [product.image] : [];
}

export function addPhoto(images, value) {
  let src = String(value ?? '').trim();
  if (!src) return [...images];
  if (!/^\/api\/shop\/image\/[a-f0-9-]+$/.test(src)) {
    try {
      const url = new URL(src);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      src = url.href;
    } catch { throw new Error('Use an uploaded image or a valid HTTPS image URL.'); }
  }
  if (images.includes(src)) return [...images];
  if (images.length >= MAX_IMAGES) throw new Error(`Use at most ${MAX_IMAGES} photos per product.`);
  return [...images, src];
}

export function movePhoto(images, from, to) {
  const result = [...images];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  const [image] = result.splice(from, 1);
  result.splice(to, 0, image);
  return result;
}
