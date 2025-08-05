import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import YouTube, { YouTubePlayer, YouTubeEvent } from 'react-youtube'

export default function HostView() {
  const [roomCode, setRoomCode] = useState('');
  const [queue, setQueue] = useState<any[]>([]);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);

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
      <h2>Room Code: {roomCode}</h2>
      {currentVideoId ? (
        <div className="video-background">
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
        <div>
          <p>No video playing.</p>
          <p>Maybe some ABBA? Taylor Swift?</p>
        </div>
      )}

      <button onClick={skipSong}>Skip Song</button>

      <h3>Global Queue</h3>
      <ul>
        {queue.map((q, i) => (
          <li key={q.id}>
            {i === 0 ? <strong>{q.title} (Now)</strong> : q.title} — {q.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
