import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import YouTube, { YouTubePlayer, YouTubeEvent } from 'react-youtube'
import { Minus } from 'lucide-react';
import { loadHost, saveHost, clearHost } from '../session';

export type HostViewProps = { onExit: ()=> void };

export default function HostView({ onExit }: HostViewProps) {
  const [roomCode, setRoomCode] = useState('');
  const [queue, setQueue] = useState<any[]>([]);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [currentSong, setCurrentSong] = useState('');
  const [currentSinger, setCurrentSinger] = useState('');
  const [nextSongTitle, setNextSongTitle] = useState("None");
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [trial, setTrial] = useState(0);
  const [members, setMembers] = useState<Map<string, any>>(new Map());
  const [membersOpen, setMembersOpen] = useState(false);

  useEffect(() => {
    const createRoom = () => {
      socket.emit('host:createRoom', {}, (res: any) => {
        if (res.error) return alert(res.error);
        saveHost({ code: res.code, hostToken: res.hostToken });
        setRoomCode(res.code);
      });
    };

    // Runs on the first connect and again after every reconnect (tab reload, wifi blip). A saved
    // session reclaims the same room via its token; otherwise start a fresh one.
    const onConnect = () => {
      const saved = loadHost();
      if (saved) {
        socket.emit('host:resumeRoom', saved, (res: any) => {
          if (res.error) { clearHost(); createRoom(); }
          else setRoomCode(res.code);
        });
      } else {
        createRoom();
      }
    };

    const handleQueueUpdate = (newQueue: any[]) => {
      const now = newQueue[0];
      setQueue(newQueue);
      setCurrentVideoId(now?.videoId ?? null);
      setCurrentSong(now ? `${now.title}- ${now.artists.join(', ')}` : "");
      setCurrentSinger(now?.singer ?? "");
      setNextSongTitle(newQueue[1]?.title ?? "None");

      // Only reset the trial run when the song at the front actually changes, so an unrelated
      // queue update mid-trial does not restart the walk from candidate 0.
      setCurrentSongId((prevId) => {
        if (now?.id !== prevId) {
          setCandidates(now?.candidates ?? []);
          setTrial(0);
        }
        return now?.id ?? null;
      });
    };

    const handleRoomUpdate = (userMap: any) => {
      setMembers(new Map(Object.entries(userMap)));
    };

    socket.on('connect', onConnect);
    socket.on('queue:update', handleQueueUpdate);
    socket.on('room:update', handleRoomUpdate);

    // on() only catches future connects; if the socket is already up, run once now.
    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('queue:update', handleQueueUpdate);
      socket.off('room:update', handleRoomUpdate);
    };
  }, []);

  const playerRef = useRef<YouTubePlayer | null>(null);

  // A song arrives with candidates and no videoId until the host proves one plays. Embed blocks,
  // age gates and rights restrictions only surface once the real player tries, so the trial runs
  // in the actual player - muted and covered - rather than in a hidden probe.
  const resolving = currentVideoId === null && candidates.length > 0;
  const playingId = currentVideoId ?? candidates[trial] ?? null;

  const trialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTrialTimer = () => {
    if (trialTimer.current) clearTimeout(trialTimer.current);
    trialTimer.current = null;
  };

  const failCurrentTrial = () => {
    clearTrialTimer();
    if (trial + 1 < candidates.length) {
      setTrial(trial + 1);
    } else {
      socket.emit('host:videoFailed', { code: roomCode, songId: currentSongId });
    }
  };

  // Bound how long the room stares at a loading screen: TRIAL_TIMEOUT_MS per candidate, and the
  // server already caps how many candidates it sends.
  const TRIAL_TIMEOUT_MS = 3000;

  useEffect(() => {
    if (!resolving) { clearTrialTimer(); return; }
    trialTimer.current = setTimeout(failCurrentTrial, TRIAL_TIMEOUT_MS);
    return clearTrialTimer;
  }, [resolving, trial, currentSongId, candidates.length]);

  const onPlayerReady = (event: YouTubeEvent) => {
    playerRef.current = event.target;
    if (resolving) event.target.mute();
    event.target.playVideo();
  };

  const onPlayerStateChange = (event: YouTubeEvent) => {
    if (!resolving) return;
    // 1 === YT.PlayerState.PLAYING. It really played, so it is safe to commit and unmute.
    if (event.data === 1) {
      clearTrialTimer();
      event.target.unMute();
      socket.emit('host:videoResolved', {
        code: roomCode,
        songId: currentSongId,
        videoId: candidates[trial],
      });
    }
  };

  const onPlayerError = () => {
    if (resolving) failCurrentTrial();
    else skipSong();
  };

  const skipSong = () => {
    console.log("skipping")
    socket.emit('host:skipSong', { code: roomCode });
  }

  const onVideoEnd = () => {
    console.log('Video ended');
    skipSong();
  }

  const removeMember = (userId: string) => {
    socket.emit("host:removeUser", { code: roomCode, userId });
  }

  const closeMembersSidebar = () => setMembersOpen(false);

  const closeRoom = () => {
    if (confirm("Are you sure you want to close this room?")) {
      socket.emit('host:closeRoom', { code: roomCode });
      clearHost();
      onExit();
    } else {
      return;
    }
  };

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
              <button onClick={() => removeMember(userId)} aria-label={`Remove ${userObject.name}`}><Minus /></button>
            </li>
          ))}
        </ul>
        <button onClick={closeRoom}>Close Room</button>
      </div>
      <div className="current">
        <h2 className="song">{currentSong ? "Now playing: " : ""}{currentSong}</h2>
        <h2 className="singer">{currentSinger ? "Requested by: " : ""}{currentSinger}</h2>
      </div>
      {playingId ? (
        <div className="theater">
          <YouTube
            key={currentSongId ?? undefined}
            videoId={playingId}
            onReady={onPlayerReady}
            opts={{
              playerVars: {
                autoplay: 1,
                controls: 1,
                playsinline: 1
              }
            }}
            onStateChange={onPlayerStateChange}
            onError={onPlayerError}
            onEnd={onVideoEnd}
          />
          {resolving && (
            <div className="theater-loading">
              <div className="spinner"></div>
              <p>Cueing up {currentSong}</p>
            </div>
          )}
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
          <p>Join at {window.location.host}</p>
        </div>

        <div className="queue-info">
          <h2>Next Song: {nextSongTitle}</h2>
          <button onClick={skipSong}>Skip Current Song</button>
        </div>

      </div>
    </div>
  );
}
