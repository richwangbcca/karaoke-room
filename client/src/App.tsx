import { useState } from 'react';
import axios from 'axios';
import UserView from './components/UserView';
import HostView from './components/HostView';

async function validateRoom(roomCode: string): Promise<boolean> {
  try {
    const response = await axios.get(`/api/rooms/${roomCode.toUpperCase()}`);
    return response.status === 200;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return false;
    }
    console.error('Unexpected error during room check:', error);
    return false;
  }
}

function App() {
  const [role, setRole] = useState<'host' | 'user' | null>(null);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const joinRoom = async () => {
    setError(null);

    if (!name.trim()) {
      setError("Please enter a name.");
      return;
    }
    if (roomCode.length !== 5) {
      setError("Invalid room code");
      return;
    }

    setLoading(true);
    const roomExists = await validateRoom(roomCode);
    setLoading(false);

    if(!roomExists) {
      setError("Room not found");
      return;
    }

    setRole('user');
  }

  if (!role) {
    return (
      <div className="home">
        <h1>Karaoke Room</h1>
        <h2>Join a room, add your songs, and sing together!</h2>
        <div className="form">
          <div className="input-box">
            <label>Name</label>
            <input placeholder="NAME" maxLength = {12} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="input-box">
            <label>Room Code</label>
            <input placeholder="ROOM CODE" className="code-input" maxLength={5} value={roomCode} onChange={(e) => setRoomCode(e.target.value)} />
          </div>
          {error && <p style={{ color: 'red', marginTop: 4 }}>{error}</p>}
          <button onClick={() => joinRoom()}>Join Room</button>
        </div>

        <label>Or, if you're a host,</label>
        <button onClick={() => setRole('host')}>Create a Room</button>
        <p>Made by @richwangbcca</p>
      </div>
    );
  }

 return role === 'host' ? <HostView /> : <UserView userName={name} code={roomCode}/>;
}

export default App;
