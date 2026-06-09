import { useState, useEffect } from 'react';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

export function useVRM(url) {
  const [vrm, setVrm] = useState(null);

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => {
      return new VRMLoaderPlugin(parser);
    });
  });

  useEffect(() => {
    if (gltf && gltf.userData.vrm) {
      const loadedVrm = gltf.userData.vrm;
      
      // Rotate avatar to face the camera (VRM models usually face -Z, we want them to face +Z)
      loadedVrm.scene.rotation.y = Math.PI;

      setVrm(loadedVrm);
    }
  }, [gltf]);

  return { vrm, scene: gltf?.scene };
}
