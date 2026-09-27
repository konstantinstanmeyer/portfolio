"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { createFigure } from "@/lib/figure";
import { createGroundPool } from "./ground";

const FOV = 30;
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** World height visible at the look-at point: the 1.75 m figure fills ~15% of it. */
const VIEW_HEIGHT = 11.5;
/** Narrow screens widen the view so the ground pool never nears the edges. */
const MIN_VIEW_WIDTH = 6;
/** Camera elevation above the horizon, in radians (~15°). */
const ELEVATION = 0.26;
/** Looking slightly above the figure's middle places it a little below centre. */
const LOOK_AT = new THREE.Vector3(0, 1.3, 0);
/** Turn the figure a little toward the key light for a three-quarter view. */
const FIGURE_YAW = -0.42;
const TAU = Math.PI * 2;

export default function SpaceScene() {
  const [ready, setReady] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      aria-hidden
      className={`absolute inset-0 transition-opacity duration-[2400ms] ease-out ${
        ready ? "opacity-100" : "opacity-0"
      }`}
    >
      <SceneErrorBoundary>
        <Canvas
          flat
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          shadows={{ enabled: true, type: THREE.PCFShadowMap }}
          camera={{ fov: FOV, near: 1, far: 80 }}
        >
          <color attach="background" args={["#000000"]} />
          <CameraRig drift={!reducedMotion} />
          <Lights />
          <GroundPool />
          <FigureObject />
          <OnFirstFrame onReady={() => setReady(true)} />
        </Canvas>
      </SceneErrorBoundary>
    </div>
  );
}

function Lights() {
  const keyTarget = useMemo(() => new THREE.Object3D(), []);
  return (
    <>
      {/* Faint sky fill so faces turned from the key never drop to pure black. */}
      <hemisphereLight args={[0xd8e0ff, 0x000000, 0.3]} />
      {/* Key: a soft spot high above, front-left. Its falloff keeps the head
          and shoulders brightest. The only shadow caster. */}
      <primitive object={keyTarget} position={[0, 1.1, 0]} />
      <spotLight
        castShadow
        target={keyTarget}
        color={0xfff3e6}
        intensity={38}
        decay={2}
        angle={0.55}
        penumbra={1}
        position={[-1.3, 4.3, 1.7]}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={1.5}
        shadow-camera-far={8}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-radius={6}
      />
      {/* Cool rim from behind to lift the silhouette off the black. */}
      <directionalLight color={0xa9bcff} intensity={1.6} position={[3.5, 3, -4.5]} />
    </>
  );
}

function GroundPool() {
  const pool = useMemo(() => createGroundPool(), []);
  useEffect(
    () => () => {
      pool.geometry.dispose();
      pool.material.dispose();
    },
    [pool],
  );
  return <mesh geometry={pool.geometry} material={pool.material} receiveShadow />;
}

function FigureObject() {
  const figure = useMemo(() => {
    const f = createFigure();
    f.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return f;
  }, []);
  useEffect(() => () => figure.dispose(), [figure]);
  useFrame((state, delta) => figure.update(state.clock.elapsedTime, delta));
  return (
    <group rotation-y={FIGURE_YAW}>
      <primitive object={figure.object} />
    </group>
  );
}

/** Frames the figure small and low, with an optional, barely perceptible drift. */
function CameraRig({ drift }: { drift: boolean }) {
  useFrame(({ camera, clock, size }) => {
    const t = drift ? clock.elapsedTime : 0;
    const aspect = Math.max(size.width, 1) / Math.max(size.height, 1);
    const viewHeight = Math.max(VIEW_HEIGHT, MIN_VIEW_WIDTH / aspect);
    const distance = viewHeight / (2 * TAN_HALF_FOV);
    const azimuth = 0.07 * Math.sin((t * TAU) / 75);
    const elevation = ELEVATION + 0.012 * Math.sin((t * TAU) / 57);
    camera.position.set(
      LOOK_AT.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      LOOK_AT.y + distance * Math.sin(elevation),
      LOOK_AT.z + distance * Math.cos(elevation) * Math.cos(azimuth),
    );
    camera.lookAt(LOOK_AT);
  });
  return null;
}

/** Calls `onReady` once the first frame has been drawn. */
function OnFirstFrame({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    // useFrame runs before each render, so the second call follows the first drawn frame.
    if (frames.current < 0) return;
    frames.current += 1;
    if (frames.current === 2) {
      frames.current = -1;
      onReady();
    }
  });
  return null;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** Without WebGL the page stays a quiet black page rather than an error screen. */
class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
