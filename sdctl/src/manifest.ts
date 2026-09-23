import type { ReleaseManifest } from './types.js';

export const DEFAULT_MANIFEST: ReleaseManifest = {
  version: '0.1.0',
  releaseDate: '2026-09-22',
  minUpgradeFrom: '0.1.0',
  images: {
    editor: {
      image: 'ghcr.io/jbraunsmajr/system-design',
      digest: 'sha256:80fe0b9bbbf29aacfc9a702ca1a751c457bf95395bb1212bc2d747c9c7f224e0',
    },
    relay: {
      image: 'ghcr.io/jbraunsmajr/system-design-relay',
      digest: 'sha256:c06ba13e6e1393ca46ef17f5a324b333d2443e006ad0dee05f8974bc29ca9c49',
    },
    proxy: {
      image: 'caddy',
      digest: 'sha256:af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17',
    },
    turn: {
      image: 'coturn/coturn',
      digest: 'sha256:bbefd3e1fdfdc0d58770fe01b581fd8b00d9f3a5580d00acb77cf719a6bc78e3',
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
