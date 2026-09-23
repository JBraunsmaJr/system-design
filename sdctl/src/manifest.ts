import type { ReleaseManifest } from './types.js';

export const DEFAULT_MANIFEST: ReleaseManifest = {
  version: '0.1.0',
  releaseDate: '2026-09-22',
  minUpgradeFrom: '0.1.0',
  images: {
    editor: {
      image: 'ghcr.io/jbraunsmajr/system-design',
      digest: 'sha256:7f4a1c518b0c8e23f95b35a712f10b0e51dc20d206f40b2a6f53a47ff6ec0b8e',
    },
    relay: {
      image: 'ghcr.io/jbraunsmajr/system-design-relay',
      digest: 'sha256:4d8a1c9e821fa91b5c3e6605a9c9f2b1897d9e4a3c10b7a421ef88012fcd99a0',
    },
    proxy: {
      image: 'caddy',
      digest: 'sha256:2b2cf691ad5c2f0f4a86b1d62c938f4d9241b7145b59740b284d7a8d8e63a8a3',
    },
    turn: {
      image: 'coturn/coturn',
      digest: 'sha256:1e6c382103f6bbda28f6f0ea99616d2b512ab424d9f6ea9b5f5832a84ba7a35c',
    },
    installer: {
      image: 'ghcr.io/jbraunsmajr/system-design-installer',
      digest: 'sha256:9a5b3c2d1e0f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b',
    },
  },
};

/**
 * Resolves full image reference using digest and optional registry prefix.
 * e.g., if image is "ghcr.io/jbraunsmajr/system-design" and prefix is "internal-registry.local:5000",
 * the image becomes "internal-registry.local:5000/system-design@sha256:...".
 */
export function resolveImage(baseImage: string, digest: string, registryPrefix?: string): string {
  let imagePath = baseImage;

  if (registryPrefix) {
    const cleanPrefix = registryPrefix.replace(/\/+$/, '');
    // Extract the component name/path after the first slash if present, or entire name
    const parts = baseImage.split('/');
    const imageName = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    imagePath = `${cleanPrefix}/${imageName}`;
  }

  // Strip any tag if present before appending digest (e.g. repo:tag -> repo@digest)
  // Tags only appear after the last slash (to avoid stripping port numbers like localhost:5000/image)
  const lastSlash = imagePath.lastIndexOf('/');
  const lastColon = imagePath.lastIndexOf(':');
  if (lastColon > lastSlash) {
    imagePath = imagePath.slice(0, lastColon);
  }

  return `${imagePath}@${digest}`;
}

export function getResolvedImages(
  manifest: ReleaseManifest = DEFAULT_MANIFEST,
  registryPrefix?: string,
) {
  return {
    editor: resolveImage(
      manifest.images.editor.image,
      manifest.images.editor.digest,
      registryPrefix,
    ),
    relay: resolveImage(manifest.images.relay.image, manifest.images.relay.digest, registryPrefix),
    proxy: resolveImage(manifest.images.proxy.image, manifest.images.proxy.digest, registryPrefix),
    turn: resolveImage(manifest.images.turn.image, manifest.images.turn.digest, registryPrefix),
    installer: resolveImage(
      manifest.images.installer.image,
      manifest.images.installer.digest,
      registryPrefix,
    ),
  };
}
