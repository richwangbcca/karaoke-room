import { useState, useEffect } from 'react';
import socket from '../socket';
import axios from 'axios';

export default function UserView() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [userId, setUserId] = useState('');
  const [joined, setJoined] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);

  useEffect(() => {
    socket.on('queue:update', (queue) => {
      setQueue(queue);
    });
  }, []);

  const joinRoom = () => {
    socket.connect();
    socket.emit('user:joinRoom', { name, code: roomCode }, (res: any) => {
      if (res.error) return alert(res.error);
      setUserId(res.userId);
      setJoined(true);
    });
  };

  const search = async () => {
    const res = await axios.get(`/api/youtube/search?q=${encodeURIComponent(searchTerm + " karaoke")}`);
    setResults(res.data);
  };

  const addSong = (videoId: string, title: string) => {
    socket.emit('user:addSong', {
      code: roomCode,
      userId,
      title,
      videoId
    }, (resp: any) => {
      if (resp.error) alert(resp.error);
    });
  };

  if (!joined) {
    return (
      <div>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Room code" value={roomCode.toUpperCase()} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />
        <button onClick={joinRoom}>Join Room</button>
      </div>
    );
  }

  return (
    <div>
      <h2>What do you want to sing, {name}?</h2>
      <div>
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search song" />
        <button onClick={search}>Search</button>
      </div>
      <ul>
        {results.map((r) => (
          <li key={r.videoId}>
            {r.title} <button onClick={() => addSong(r.videoId, r.title)}>Add</button>
          </li>
        ))}
      </ul>

      <h3>Your Queue</h3>
      <ul>
        {queue.filter(q => q.requestedBy === userId).map((q) => (
          <li key={q.id}>{q.title}</li>
        ))}
      </ul>
    </div>
  );
}
