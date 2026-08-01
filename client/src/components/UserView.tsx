import { useState, useEffect } from 'react';
import { Plus, Minus, Search } from 'lucide-react';
import { findVideo, checkVideo } from './videoHelper';
import socket from '../socket';

export type UserViewProps = { userName: string; code: string; onExit: ()=> void };

export default function UserView({ userName, code, onExit }: UserViewProps) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [userId, setUserId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  // Establish user states
  useEffect(() => {
    setName(userName);
    setRoomCode(code.toUpperCase());
  }, [userName, code]);

  // Connect to room and to queue/user-specific events
  useEffect(() => {
    if (!name || !roomCode) return;
    socket.connect();
    socket.emit('user:joinRoom', { code: roomCode, name }, (res: any) => {
      if (res.error) return alert(res.error);
      setUserId(res.userId);
    });

    const handleQueueUpdate = (queue: any[]) => setQueue(queue);
    const handleRemoveUser = () => onExit();
    const handleCloseRoom = () => onExit();

    socket.on('queue:update', handleQueueUpdate);
    socket.on('host:removeUser', handleRemoveUser);
    socket.on('host:closeRoom', handleCloseRoom);

    return () => {
      socket.off('queue:update', handleQueueUpdate);
      socket.off('host:removeUser', handleRemoveUser);
      socket.off('host:closeRoom', handleCloseRoom);
    };
  }, [name, roomCode]);

  // Search bar
  const search = async () => {
    if(!searchTerm) {
      setResults([]);
      return;
    }

    setLoading(true);
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(searchTerm)}`);
    if (!res.ok) {
      console.warn(`Fetch error: ${res.status}`);
      setLoading(false);
      return;
    }
    const data = await res.json();

    setResults(data);
    setLoading(false);
  };

  type ResolveResult = { videoId?: string; videos?: string[]; error?: string };
  const resolveVideo = (searchTerm: string, skipCache = false) =>
    new Promise<ResolveResult>((resolve) =>
      socket.emit('user:resolveVideo', { searchTerm, skipCache }, resolve));

  // Add song to queue
  const addSong = async(title: string, artists: string[], albumImage: string) => {
    setAdding(true);
    const searchTerm = `${title} ${artists[0]} karaoke`;

    const queueSong = (videoId: string) => {
      socket.emit('user:addSong', {
        code: roomCode,
        userId,
        title: title,
        artists: artists,
        videoId,
        albumImage,
      });

      setResults([]);
      setSearchTerm("");
      setAdding(false);
    };

    let result = await resolveVideo(searchTerm);

    if (result.videoId) {
      if (await checkVideo(result.videoId)) return queueSong(result.videoId);

      // Bypass the stale entry
      console.log('Cached video no longer playable, falling back to search');
      result = await resolveVideo(searchTerm, true);
    }

    const videos = result.videos ?? [];
    if (!videos.length) {
      console.warn(result.error ?? 'No videos found');
      setAdding(false);
      return;
    }

    try {
      const playable = await findVideo(videos);
      socket.emit('user:cacheVideo', { searchTerm, videoId: playable });
      queueSong(playable);
    } catch (err) {
      console.warn('No playable videos found', err);
      socket.emit('user:cacheVideo', { searchTerm, videoId: null });
      setAdding(false);
    }
  };

  // Remove song from queue
  const removeSong = async(songId: string) => {
    socket.emit('user:removeSong', {code: roomCode, songId});
  }

  // User leaves room
  const leaveRoom = async() => {
    socket.emit('user:leaveRoom', {code: roomCode, userId});
    onExit();
  }

  return (
    <div>
      <button className="leave-room" onClick={leaveRoom}> Leave Room </button>
      <h2>What do you want to sing, {name}?</h2>
      <form action={search} className="search-bar">
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search song" />
        <button onClick={search}><Search size={24}/></button>
      </form>
      {loading ? (
        <div className="spinner"></div>
      ) : (
        <ul>
          {results.map((r) => (
            <li className="song-card" key={r.trackId}>
              <img className="album" src={r.albumImage}/>
              <div className="track-text">
                <p className="track-name">{r.trackName}</p> 
                <p className="artists">{r.artists.join(', ')}</p> 
              </div>
              <button onClick={() => addSong(r.trackName, r.artists, r.albumImage)} disabled={adding}><Plus size={24}/></button>
            </li>
          ))}
        </ul>
      )}

      <h3>Your Queue</h3>
      <ul>
        {queue.slice(1).filter(q => q.requestedBy === userId).map((q) => (
          <li className="song-card" key={q.id}>
            <img className="album" src={q.albumImage}/>
            <div className="track-text">
              <p className="track-name">{q.title}</p> 
              <p className="artists">{q.artists.join(', ')}</p> 
            </div>
            <button onClick={() => removeSong(q.id)}><Minus size={24}/></button>
          </li>
        ))}
      </ul>
      <h3>Global Queue</h3>
      <ul>
        {queue.slice(1).map((q) => (
          <li className="song-card" key={q.id}>
            <img className="album" src={q.albumImage}/>
            <div className="track-text">
              <p className="track-name">{q.title}</p> 
              <p className="artists">{q.artists.join(', ')}</p> 
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
