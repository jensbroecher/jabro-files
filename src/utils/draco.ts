import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let sharedDracoLoader: DRACOLoader | null = null;

export function getDracoDecoderPath(): string {
  // If in web dev mode, use root-relative path
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return '/draco/gltf/';
  }
  // If running from file:// in packaged app or built dist
  return './draco/gltf/';
}

export function getSharedDracoLoader(): DRACOLoader {
  if (!sharedDracoLoader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(getDracoDecoderPath());
    draco.preload();
    sharedDracoLoader = draco;
  }
  return sharedDracoLoader;
}

export function setupGLTFLoader(loader: GLTFLoader): GLTFLoader {
  loader.setDRACOLoader(getSharedDracoLoader());
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
