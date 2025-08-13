import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import YouTube, { YouTubePlayer, YouTubeEvent } from 'react-youtube'
import { Minus } from 'lucide-react';

export default function HostView() {
  const [roomCode, setRoomCode] = useState('');
  const [queue, setQueue] = useState<any[]>([]);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [currentSong, setCurrentSong] = useState('');
  const [currentSinger, setCurrentSinger] = useState('');
  const [nextSongTitle, setNextSongTitle] = useState("None");
  const [members, setMembers] = useState<Map<string, any>>(new Map());
  const [membersOpen, setMembersOpen] = useState(false);

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
          setCurrentSong(newQueue[0] ? `${newQueue[0].title}- ${newQueue[0].artists.join(', ')}` : "");
          setCurrentSinger(newQueue[0]?.singer ?? "");
          setNextSongTitle(newQueue[1]?.title ?? "None");
        });

        socket.on('room:update', (userMap) => {
          const memberMap = new Map(Object.entries(userMap));
          setMembers(memberMap);
        })
      }
    });

    return () => {
      socket.off('queue:update');
      socket.off('room:update');
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
      if (res.error) {
        console.warn(res.error);
      }
    });
  }

  const onVideoEnd = () => {
    console.log('Video ended');
    skipSong();
  }

  const removeMember = (userId: string) => {
    socket.emit("host:removeUser", { code: roomCode, userId }, (res: any) => {
      if (res.error) {
        console.warn(res.error);
      }
    })
  }

  const closeMembersSidebar = () => setMembersOpen(false);

  if (!roomCode) {
    return <p>Creating your room...</p>;
  }

  return (
    <div className="host-view">
      {membersOpen && <div className='backdrop' onClick={closeMembersSidebar} />}
      <div className={`member-sidebar ${membersOpen ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <h2>Room Members</h2>
        <ul>
          {[...members].map(([userId, userObject]) => (
            <li className="member-card" key={userId}>
              <p>{userObject.name}</p>
              <button onClick={() => removeMember(userId)}><Minus /></button>
            </li>
          ))}
        </ul>
        <button>Close Room</button>
      </div>
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
          <button onClick={() => setMembersOpen(true)}>👤 {members.size}</button>
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
