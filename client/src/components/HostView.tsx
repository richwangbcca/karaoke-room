import { useState, useEffect } from 'react';
import socket from '../socket';
import YouTube from 'react-youtube'

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

  const skipSong = () => {
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
    <div>
      <h2>Room Code: {roomCode}</h2>
      {currentVideoId ? (
        <YouTube
          videoId={currentVideoId}
          opts={{
            width:'560',
            height:'315',
            playerVars: {
              autoplay: 1,
            }
          }}
          onEnd={onVideoEnd}
        />
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
