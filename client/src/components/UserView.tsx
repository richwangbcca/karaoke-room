import { useState, useEffect } from 'react';
import { Plus, Minus, Search } from 'lucide-react';
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
  const [addError, setAddError] = useState('');

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

  // Add song to queue. The server finds the video and the host proves it plays - a phone cannot,
  // because mobile browsers refuse to play hidden video.
  const addSong = async(title: string, artists: string[], albumImage: string) => {
    setAdding(true);
    setAddError('');

    // No userId: the server identifies the guest by their socket, not by what the page claims.
    const res = await new Promise<{ ok?: boolean; error?: string }>((resolve) =>
      socket.emit('user:addSong', { code: roomCode, title, artists, albumImage }, resolve));

    setAdding(false);
    if (res.error) return setAddError(res.error);

    setResults([]);
    setSearchTerm("");
  };

  // Remove song from queue
  const removeSong = async(songId: string) => {
    socket.emit('user:removeSong', {code: roomCode, songId});
  }

  // User leaves room
  const leaveRoom = async() => {
    socket.emit('user:leaveRoom', {code: roomCode});
    onExit();
  }

  return (
    <div>
      <button className="leave-room" onClick={leaveRoom}> Leave Room </button>
      <h2>What do you want to sing, {name}?</h2>
      <form action={search} className="search-bar">
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search song" />
        <button type="submit" aria-label="Search"><Search size={24}/></button>
      </form>
      {addError && <p className="add-error">{addError}</p>}
      {loading ? (
        <div className="spinner"></div>
      ) : (
        <ul>
          {results.map((r) => (
            <li className="song-card" key={r.trackId}>
              <img className="album" src={r.albumImage} alt=""/>
              <div className="track-text">
                <p className="track-name">{r.trackName}</p>
                <p className="artists">{r.artists.join(', ')}</p>
              </div>
              <button onClick={() => addSong(r.trackName, r.artists, r.albumImage)} disabled={adding} aria-label={`Add ${r.trackName}`}><Plus size={24}/></button>
            </li>
          ))}
        </ul>
      )}

      <h3>Your Queue</h3>
      <ul>
        {queue.slice(1).filter(q => q.requestedBy === userId).map((q) => (
          <li className="song-card" key={q.id}>
            <img className="album" src={q.albumImage} alt=""/>
            <div className="track-text">
              <p className="track-name">{q.title}</p>
              <p className="artists">{q.artists.join(', ')}</p>
            </div>
            <button onClick={() => removeSong(q.id)} aria-label={`Remove ${q.title}`}><Minus size={24}/></button>
          </li>
        ))}
      </ul>
      <h3>Global Queue</h3>
      <ul>
        {queue.slice(1).map((q) => (
          <li className="song-card" key={q.id}>
            <img className="album" src={q.albumImage} alt=""/>
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
