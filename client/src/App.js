import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import UserView from './components/UserView';
import HostView from './components/HostView';
async function validateRoom(roomCode) {
    try {
        const response = await fetch(`/api/rooms/${roomCode.toUpperCase()}`);
        return response.ok;
    }
    catch (error) {
        console.error('Unexpected error during room check:', error);
        return false;
    }
}
function App() {
    const [role, setRole] = useState(null);
    const [name, setName] = useState("");
    const [roomCode, setRoomCode] = useState("");
    const [error, setError] = useState(null);
    const joinRoom = async () => {
        if (!name.trim()) {
            setError("Please enter a name.");
            return;
        }
        if (roomCode.length !== 5) {
            setError("Invalid room code");
            return;
        }
        const roomExists = await validateRoom(roomCode);
        if (!roomExists) {
            setError("Room not found");
            return;
        }
        setRole('user');
    };
    if (!role) {
        return (_jsxs("div", { className: "home", children: [_jsx("h1", { children: "Karaoke Room \uD83C\uDFA4" }), _jsx("h2", { children: "Join a room, add your songs, and sing together!" }), _jsxs("div", { className: "form", children: [_jsxs("div", { className: "input-box", children: [_jsx("label", { children: "Name" }), _jsx("input", { placeholder: "NAME", maxLength: 12, value: name, onChange: (e) => setName(e.target.value) })] }), _jsxs("div", { className: "input-box", children: [_jsx("label", { children: "Room Code" }), _jsx("input", { placeholder: "ROOM CODE", className: "code-input", maxLength: 5, value: roomCode, onChange: (e) => setRoomCode(e.target.value) })] })] }), error && _jsx("p", { className: "error", children: error }), _jsx("button", { onClick: () => joinRoom(), children: "Join Room" }), _jsxs("div", { className: "host-div", children: [_jsx("h2", { children: "If you're a host" }), _jsx("button", { onClick: () => setRole('host'), children: "Create a Room" })] }), _jsx("p", { children: "Made by @richwangbcca" })] }));
    }
    return role === 'host' ?
        _jsx(HostView, { onExit: () => { setRole(null); setName(''); setRoomCode(''); } })
        : _jsx(UserView, { userName: name, code: roomCode, onExit: () => { setRole(null); setName(''); setRoomCode(''); } });
}
export default App;
