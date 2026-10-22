import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProduct } from '../lib/domain.mjs';
import { MAX_IMAGES, photosFor, addPhoto, movePhoto } from '../public/shop/photos.js';

const product = { title: 'Gallery tee', priceCents: 3500, active: true,
  variants: [{ size: 'L', color: 'Black', stock: 4 }] };
const photos = ['https://example.com/front.jpg', 'https://example.com/back.jpg', 'https://example.com/detail.jpg'];

test('existing single-photo products remain editable and readable', () => {
  const legacy = { ...product, image: photos[0] };
  assert.deepEqual(photosFor(legacy), [photos[0]]);
  const saved = validateProduct(legacy);
  assert.deepEqual(saved.images, [photos[0]]);
  assert.equal(saved.image, photos[0]);
});

test('ordered photos persist and the first photo remains the cover for cards and bags', () => {
  const saved = validateProduct({ ...product, image: 'https://example.com/obsolete.jpg', images: photos });
  assert.deepEqual(saved.images, photos);
  assert.equal(saved.image, photos[0]);
  const reordered = movePhoto(photos, 2, 0);
  const updated = validateProduct({ ...saved, images: reordered }, saved);
  assert.equal(updated.image, photos[2]);
  assert.deepEqual(updated.images, [photos[2], photos[0], photos[1]]);
  assert.equal(updated.variants[0].id, saved.variants[0].id);
  assert.equal(updated.variants[0].stock, 4);
});

test('removing photos, including all photos, does not resurrect the old cover', () => {
  const saved = validateProduct({ ...product, images: photos });
  const updated = validateProduct({ ...saved, images: photos.slice(1) }, saved);
  assert.equal(updated.image, photos[1]);
  const cleared = validateProduct({ ...updated, images: [] }, updated);
  assert.equal(cleared.image, '');
  assert.deepEqual(photosFor(cleared), []);
});

test('a cached single-image manager can update stock without deleting gallery photos', () => {
  const saved = validateProduct({ ...product, images: photos });
  const { images, ...oldClientInput } = saved;
  const updated = validateProduct({ ...oldClientInput, title: 'Updated tee' }, saved);
  assert.deepEqual(updated.images, photos);
  assert.equal(updated.title, 'Updated tee');
});

test('gallery validation deduplicates images and rejects unsafe links or excessive galleries', () => {
  assert.deepEqual(validateProduct({ ...product, images: [photos[0], photos[0], photos[1]] }).images, photos.slice(0, 2));
  assert.throws(() => validateProduct({ ...product, images: 'wrong' }), /must be a list/);
  assert.throws(() => validateProduct({ ...product, images: ['javascript:alert(1)'] }), /HTTPS/);
  assert.throws(() => validateProduct({ ...product, images: Array.from({ length: 13 }, (_, i) => `https://example.com/${i}.jpg`) }), /at most 12/);
  const max = Array.from({ length: MAX_IMAGES }, (_, i) => `https://example.com/${i}.jpg`);
  assert.equal(validateProduct({ ...product, images: max }).images.length, MAX_IMAGES);
});

test('manager photo edits preserve order without changing the source array', () => {
  assert.deepEqual(addPhoto(photos, photos[0]), photos);
  assert.deepEqual(movePhoto(photos, 0, 1), [photos[1], photos[0], photos[2]]);
  assert.deepEqual(movePhoto(photos, 0, -1), photos);
  assert.deepEqual(movePhoto(photos, 2, 3), photos);
  assert.deepEqual(photos, ['https://example.com/front.jpg', 'https://example.com/back.jpg', 'https://example.com/detail.jpg']);
  assert.throws(() => addPhoto([], 'data:image/svg+xml,bad'), /HTTPS/);
  assert.throws(() => addPhoto(Array.from({ length: 12 }, (_, i) => `https://example.com/${i}.jpg`), 'https://example.com/extra.jpg'), /at most 12/);
});
