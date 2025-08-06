import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import YouTube, { YouTubePlayer, YouTubeEvent } from 'react-youtube'

export default function HostView() {
  const [roomCode, setRoomCode] = useState('');
  const [queue, setQueue] = useState<any[]>([]);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [nextSongTitle, setNextSongTitle] = useState("None");

  // Establish room code and initiate queue
  useEffect(() => {
    socket.connect();

    socket.emit('host:createRoom', {}, (res: any) => {
      if (res.error) {
        alert(res.error);
      } else {
        setRoomCode(res.code);
        
        socket.on('queue:update', (newQueue) => {
          setQueue(newQueue);
          setCurrentVideoId(newQueue[0]?.videoId ?? null);
          setNextSongTitle(newQueue[1]?.title ?? "None");
        });
      }
    });

    return () => {
      socket.off('queue:update');
      socket.disconnect();
    };
  }, []);

  const playerRef = useRef<YouTubePlayer | null>(null);

  const onPlayerReady = (event: YouTubeEvent) => {
    playerRef.current = event.target;
  };

  const skipSong = () => {
    console.log("skipping")
    socket.emit('host:skipSong', { code: roomCode }, (res: any) => {
      if (res.error){
        alert(res.error);
      }
    });
  }

  const onVideoEnd = () => {
    console.log('Video ended');
    skipSong();
  }

  if (!roomCode) {
    return <p>Creating your room...</p>;
  }

  return (
    <div className="host-view">
      {currentVideoId ? (
        <div className="theater">
          <YouTube
            videoId={currentVideoId ?? undefined}
            onReady={onPlayerReady}
            opts={{
              playerVars: {
                autoplay: 1,
                controls: 1
              }
            }}
            onEnd={onVideoEnd}
          />
        </div>
      ) : (
        <div className="theater">
          <p>No video playing.</p>
          <p>Maybe some ABBA? Taylor Swift?</p>
        </div>
      )}
      <div className="footer">
        <h2 className="num-users">👤 0</h2>

        <div className="room-info">
          <h2 className="room-code">Room Code: {roomCode}</h2>
          <p>Join at placeholder.com</p>
        </div>

        <div className="queue-info">
          <h2>Next Song: {nextSongTitle.slice(0, 30)}</h2>
          <button onClick={skipSong}>Skip Current Song</button>
        </div>

      </div>
    </div>
  );
}
