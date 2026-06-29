declare global {
  interface Window {
    YT: any;
    onYouTubeIframeReady: () => void;
  }
}

let youtubeLoadPromise: Promise<void> | null = null;

export function loadYouTube(): Promise<void> {
  // If already loaded, return immediately
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }

  // If currently loading, return the existing promise
  if (youtubeLoadPromise) {
    return youtubeLoadPromise;
  }

  // Create new loading promise
  youtubeLoadPromise = new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;
    let resolved = false;

    // Check if YT loaded by polling
    const checkYTLoaded = () => {
      if (window.YT && window.YT.Player) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          clearInterval(checkIntervalId);
          resolve();
        }
      }
    };

    // Set the callback just in case it fires
    window.onYouTubeIframeReady = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        clearInterval(checkIntervalId);
        resolve();
      }
    };

    // Set a timeout in case the script never loads
    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(checkIntervalId);
        reject(new Error("YouTube API failed to load"));
      }
    }, 10000);

    // Poll for YT to be available (in case callback doesn't fire)
    const checkIntervalId = setInterval(checkYTLoaded, 100);

    // Add the script
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        clearInterval(checkIntervalId);
        reject(new Error("Failed to load YouTube iframe API script"));
      }
    };
    document.body.appendChild(tag);
  });

  return youtubeLoadPromise;
}

export async function findVideo(
  candidateIds: string[]
): Promise<string> {
  console.log("findVideo: Starting");
  await loadYouTube();
  console.log("findVideo: YouTube loaded, YT.Player exists?", !!window.YT?.Player);

  return new Promise((resolve, reject) => {
    let current = 0;
    let player: any = null;
    let timeout: NodeJS.Timeout | null = null;
    let resolved = false;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (player) {
        try {
          player.destroy();
        } catch (e) {
          // Ignore destroy errors
        }
        player = null;
      }
    };

    const tryNext = () => {
      console.log("tryNext: called");
      cleanup();

      if (current >= candidateIds.length) {
        resolved = true;
        console.error("findVideo: No more candidates");
        reject(new Error("No playable videos found"));
        return;
      }

      const videoId = candidateIds[current++];
      console.log("tryNext: Testing video", videoId);

      const container = document.createElement("div");
      container.style.width = "0px";
      container.style.height = "0px";
      container.style.opacity = "0";
      document.body.appendChild(container);
      console.log("tryNext: Container created");

      // Set a timeout for this video - if it doesn't play within 5 seconds, try next
      timeout = setTimeout(() => {
        if (!resolved) {
          console.warn(`Video ${videoId} timed out, trying next`);
          container.remove();
          tryNext();
        }
      }, 5000);

      try {
        console.log("tryNext: About to create YT.Player");
        player = new window.YT.Player(container, {
          videoId,
          playerVars: { autoplay: 0, mute: 1 },
          events: {
            onReady: (event: any) => {
              console.log("onReady fired for", videoId);
              event.target.mute();
              event.target.playVideo();
            },
            onStateChange: (event: any) => {
              console.log("onStateChange for", videoId, "state:", event.data);
              if (!resolved && event.data === window.YT.PlayerState.PLAYING) {
                console.log("Video PLAYING:", videoId);
                resolved = true;
                cleanup();
                container.remove();
                resolve(videoId);
              }
            },
            onError: (event: any) => {
              console.warn(`onError for ${videoId}, error code:`, event.data);
              if (!resolved) {
                console.warn(`Video ${videoId} error, trying next`);
                container.remove();
                tryNext();
              }
            },
          },
        });
        console.log("tryNext: YT.Player created successfully");
      } catch (error) {
        console.warn(`Failed to create player for ${videoId}:`, error);
        container.remove();
        tryNext();
      }
    };

    console.log("findVideo: Calling tryNext for first time");
    tryNext();
  });
}

export async function checkVideo(videoId: string): Promise<boolean> {
  await loadYouTube();

  return new Promise((resolve) => {
    const container = document.createElement("div");
    container.style.width = "0px";
    container.style.height = "0px";
    container.style.opacity = "0";
    document.body.appendChild(container);

    let resolved = false;
    let player: any = null;

    // Timeout after 5 seconds - if video doesn't play, consider it unplayable
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.warn(`checkVideo timeout for ${videoId}`);
        resolved = true;
        if (player) {
          try {
            player.destroy();
          } catch (e) {
            // Ignore destroy errors
          }
        }
        container.remove();
        resolve(false);
      }
    }, 5000);

    try {
      player = new window.YT.Player(container, {
        videoId,
        playerVars: { autoplay: 0, mute: 1 },
        events: {
          onReady: (event: any) => {
            event.target.mute();
            event.target.playVideo();
          },
          onStateChange: (event: any) => {
            if (!resolved && event.data === window.YT.PlayerState.PLAYING) {
              resolved = true;
              clearTimeout(timeout);
              player.destroy();
              container.remove();
              resolve(true);
            }
          },
          onError: () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              if (player) {
                try {
                  player.destroy();
                } catch (e) {
                  // Ignore destroy errors
                }
              }
              container.remove();
              resolve(false);
            }
          },
        },
      });
    } catch (error) {
      console.warn(`Failed to create player for checkVideo:`, error);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        container.remove();
        resolve(false);
      }
    }
  });
}
