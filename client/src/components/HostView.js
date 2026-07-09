import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import socket from '../socket';
import YouTube from 'react-youtube';
import { Minus } from 'lucide-react';
export default function HostView({ onExit }) {
    const [roomCode, setRoomCode] = useState('');
    const [queue, setQueue] = useState([]);
    const [currentVideoId, setCurrentVideoId] = useState(null);
    const [currentSong, setCurrentSong] = useState('');
    const [currentSinger, setCurrentSinger] = useState('');
    const [nextSongTitle, setNextSongTitle] = useState("None");
    const [members, setMembers] = useState(new Map());
    const [membersOpen, setMembersOpen] = useState(false);
    useEffect(() => {
        socket.connect();
        socket.emit('host:createRoom', {}, (res) => {
            if (res.error)
                alert(res.error);
            else
                setRoomCode(res.code);
        });
        const handleQueueUpdate = (newQueue) => {
            setQueue(newQueue);
            setCurrentVideoId(newQueue[0]?.videoId ?? null);
            setCurrentSong(newQueue[0] ? `${newQueue[0].title}- ${newQueue[0].artists.join(', ')}` : "");
            setCurrentSinger(newQueue[0]?.singer ?? "");
            setNextSongTitle(newQueue[1]?.title ?? "None");
        };
        const handleRoomUpdate = (userMap) => {
            setMembers(new Map(Object.entries(userMap)));
        };
        socket.on('queue:update', handleQueueUpdate);
        socket.on('room:update', handleRoomUpdate);
        return () => {
            socket.off('queue:update', handleQueueUpdate);
            socket.off('room:update', handleRoomUpdate);
        };
    }, []);
    const playerRef = useRef(null);
    const onPlayerReady = (event) => {
        playerRef.current = event.target;
    };
    const skipSong = () => {
        console.log("skipping");
        socket.emit('host:skipSong', { code: roomCode });
    };
    const onVideoEnd = () => {
        console.log('Video ended');
        skipSong();
    };
    const removeMember = (userId) => {
        socket.emit("host:removeUser", { code: roomCode, userId });
    };
    const closeMembersSidebar = () => setMembersOpen(false);
    const closeRoom = () => {
        if (confirm("Are you sure you want to close this room?")) {
            socket.emit('host:closeRoom', { code: roomCode });
            onExit();
        }
        else {
            return;
        }
    };
    if (!roomCode) {
        return _jsx("p", { children: "Creating your room..." });
    }
    return (_jsxs("div", { className: "host-view", children: [membersOpen && _jsx("div", { className: 'backdrop', onClick: closeMembersSidebar }), _jsxs("div", { className: `member-sidebar ${membersOpen ? "open" : ""}`, onClick: (e) => e.stopPropagation(), children: [_jsx("h2", { children: "Room Members" }), _jsx("ul", { children: [...members].map(([userId, userObject]) => (_jsxs("li", { className: "member-card", children: [_jsx("p", { children: userObject.name }), _jsx("button", { onClick: () => removeMember(userId), children: _jsx(Minus, {}) })] }, userId))) }), _jsx("button", { onClick: closeRoom, children: "Close Room" })] }), _jsxs("div", { className: "current", children: [_jsxs("h2", { className: "song", children: [currentSong ? "Now playing: " : "", currentSong] }), _jsxs("h2", { className: "singer", children: [currentSinger ? "Requested by: " : "", currentSinger] })] }), currentVideoId ? (_jsx("div", { className: "theater", children: _jsx(YouTube, { videoId: currentVideoId ?? undefined, onReady: onPlayerReady, opts: {
                        playerVars: {
                            autoplay: 1,
                            controls: 1
                        }
                    }, onEnd: onVideoEnd }) })) : (_jsxs("div", { className: "theater", children: [_jsx("p", { children: "No video playing." }), _jsx("p", { children: "Maybe some ABBA? Taylor Swift?" })] })), _jsxs("div", { className: "footer", children: [_jsx("div", { className: "num-users", children: _jsxs("button", { onClick: () => setMembersOpen(true), children: ["\uD83D\uDC64 ", members.size] }) }), _jsxs("div", { className: "room-info", children: [_jsxs("h2", { className: "room-code", children: ["Room Code: ", roomCode] }), _jsx("p", { children: "Join at placeholder.com" })] }), _jsxs("div", { className: "queue-info", children: [_jsxs("h2", { children: ["Next Song: ", nextSongTitle] }), _jsx("button", { onClick: skipSong, children: "Skip Current Song" })] })] })] }));
}
