import React, { Suspense, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { useVRM } from '../hooks/useVRM';
import { updateVRMWithMediaPipe } from '../services/vrmSolver';
import * as THREE from 'three';

const VRMAvatar = ({ url, poseDataRef, playbackDataRef, playbackIndexRef }) => {
  const { vrm, scene } = useVRM(url);

  useFrame((state, delta) => {
    if (vrm) {
      // 1. Check if we are in playback mode
      if (playbackDataRef && playbackDataRef.current && playbackDataRef.current.length > 0 && playbackIndexRef) {
        const frames = playbackDataRef.current;
        const index = playbackIndexRef.current;
        
        if (index < frames.length) {
          const frameData = frames[index];
          if (frameData && frameData.hasData) {
            updateVRMWithMediaPipe(
              vrm, 
              frameData, 
              frameData.videoWidth || 640, 
              frameData.videoHeight || 480
            );
          }
        }
      } 
      // 2. Otherwise use live tracking
      else if (poseDataRef && poseDataRef.current && poseDataRef.current.hasData) {
        updateVRMWithMediaPipe(
          vrm, 
          poseDataRef.current, 
          poseDataRef.current.videoWidth || 640, 
          poseDataRef.current.videoHeight || 480
        );
      } 
      // 3. Idle mode
      else {
        const time = state.clock.getElapsedTime();
        vrm.scene.position.y = Math.sin(time * 2) * 0.01;
      }

      // Update VRM physics
      vrm.update(delta);
    }
  });

  if (!scene) return null;

  return <primitive object={scene} />;
};

export const AvatarCanvas = ({ url = '/models/avatar.vrm', poseDataRef, playbackDataRef, playbackIndexRef, ...props }) => {
  return (
    <div className="w-full h-full relative" {...props}>
      <Canvas
        camera={{ position: [0, 1.3, 1.5], fov: 45 }}
        gl={{ preserveDrawingBuffer: true, alpha: true }}
      >
        <color attach="background" args={['#1a262e']} />
        
        {/* Lighting */}
        <ambientLight intensity={0.8} />
        <directionalLight position={[1, 2, 1]} intensity={1} castShadow />
        <Environment preset="city" />

        <Suspense fallback={null}>
          <VRMAvatar url={url} poseDataRef={poseDataRef} playbackDataRef={playbackDataRef} playbackIndexRef={playbackIndexRef} />
          <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={10} blur={2} far={2} />
        </Suspense>

        <OrbitControls 
          target={[0, 1.3, 0]} 
          minDistance={0.5} 
          maxDistance={3}
          maxPolarAngle={Math.PI / 2 + 0.1}
          enablePan={true}
        />
      </Canvas>
    </div>
  );
};
