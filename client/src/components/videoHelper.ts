declare global {
  interface Window {
    YT: any;
    onYouTubeIframeReady: () => void;
  }
}

export function loadYouTube(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);
    window.onYouTubeIframeReady = () => resolve();
  });
}

export async function findVideo(
  candidateIds: string[]
): Promise<string> {
  await loadYouTube();

  return new Promise((resolve, reject) => {
    let current = 0;
    let player: any = null;

    const tryNext = () => {
      if (player) {
        player.destroy();
        player = null;
      }
      if (current >= candidateIds.length) {
        reject(new Error("No playable videos found"));
        return;
      }

      const videoId = candidateIds[current++];
      const container = document.createElement("div");
      container.style.width = "0px";
      container.style.height = "0px";
      container.style.opacity = "0";
      document.body.appendChild(container);

      player = new window.YT.Player(container, {
      videoId,
      playerVars: { autoplay: 0, mute: 1 },
      events: {
        onReady: (event: any) => {
          event.target.mute();
          event.target.playVideo();
        },
        onStateChange: (event: any) => {
          if (event.data === window.YT.PlayerState.PLAYING) {
            resolve(videoId);
            player?.destroy();
            container.remove();
          }
        },
        onError: (event: any) => {
          player?.destroy();
          container.remove();
          tryNext();
        },
      },
    });

    };

    tryNext();
  });
}
