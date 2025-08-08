import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import YouTube, { YouTubePlayer, YouTubeEvent } from 'react-youtube'

export default function HostView() {
  const [roomCode, setRoomCode] = useState('');
  const [queue, setQueue] = useState<any[]>([]);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [currentSong, setCurrentSong] = useState('');
  const [currentSinger, setCurrentSinger] = useState('');
  const [nextSongTitle, setNextSongTitle] = useState("None");
  const [members, setMembers] = useState<string[]>([]);

  useEffect(() => {
    socket.connect();

    socket.emit('host:createRoom', {}, (res: any) => {
      if (res.error) {
        alert(res.error);
      } else {
        setRoomCode(res.code);
        
        socket.on('queue:update', (newQueue) => {
          setQueue(newQueue);
          console.log(newQueue[0]);
          setCurrentVideoId(newQueue[0]?.videoId ?? null);
          setCurrentSong(newQueue[0]?.title ?? "");
          setCurrentSinger(newQueue[0]?.singer ?? "");
          setNextSongTitle(newQueue[1]?.title ?? "None");
        });

        socket.on('room:update', (userList) => {
          setMembers(userList);
        })
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
      <div className="current">
        <h2 className="song">{currentSong ? "Now playing: " : ""}{currentSong}</h2>
        <h2 className="singer">{currentSinger ? "Requested by: " : ""}{currentSinger}</h2>
      </div>
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
        <div className="num-users">
          <h2 className="num-users">👤 {members.length}</h2>
        </div>

        <div className="room-info">
          <h2 className="room-code">Room Code: {roomCode}</h2>
          <p>Join at placeholder.com</p>
        </div>

        <div className="queue-info">
          <h2>Next Song: {nextSongTitle}</h2>
          <button onClick={skipSong}>Skip Current Song</button>
        </div>

      </div>
    </div>
  );
}
