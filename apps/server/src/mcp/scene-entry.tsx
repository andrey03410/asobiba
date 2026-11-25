import React from "react";
import { Composition, registerRoot } from "remotion";
import { DEFAULT_STUDIO_PROPS, StudioVideo, type StudioVideoProps } from "@douga/render/StudioVideo";

type Props = Record<string, unknown>;

function PlayerScene() {
  return (
    <Composition
      id="PlayerScene"
      component={StudioVideo as unknown as React.FC<Props>}
      defaultProps={DEFAULT_STUDIO_PROPS as unknown as Props}
      durationInFrames={1}
      fps={30}
      width={1280}
      height={720}
      calculateMetadata={({ props }) => {
        const { plan } = props as unknown as StudioVideoProps;
        return { durationInFrames: plan.durationInFrames, fps: plan.fps, width: plan.width, height: plan.height };
      }}
    />
  );
}

registerRoot(PlayerScene);
