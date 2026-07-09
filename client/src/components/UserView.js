import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Plus, Minus, Search } from 'lucide-react';
import { findVideo, checkVideo } from './videoHelper';
import socket from '../socket';
export default function UserView({ userName, code, onExit }) {
    const [name, setName] = useState('');
    const [roomCode, setRoomCode] = useState('');
    const [userId, setUserId] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState([]);
    const [queue, setQueue] = useState([]);
    const [loading, setLoading] = useState(false);
    const [adding, setAdding] = useState(false);
    // Establish user states
    useEffect(() => {
        setName(userName);
        setRoomCode(code.toUpperCase());
    }, [userName, code]);
    // Connect to room and to queue/user-specific events
    useEffect(() => {
        if (!name || !roomCode)
            return;
        socket.connect();
        socket.emit('user:joinRoom', { code: roomCode, name }, (res) => {
            if (res.error)
                return alert(res.error);
            setUserId(res.userId);
        });
        const handleQueueUpdate = (queue) => setQueue(queue);
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
        if (!searchTerm) {
            setResults([]);
            return;
        }
        setLoading(true);
        const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(searchTerm)}`);
        if (!res.ok) {
            console.warn(`Fetch error: ${res.status}`);
        }
        const data = await res.json();
        setResults(data);
        setLoading(false);
    };
    // Add song to queue
    const addSong = async (title, artists, albumImage) => {
        console.log("addSong: Starting");
        setAdding(true);
        const searchTerm = `${title} ${artists[0]} karaoke`;
        console.log(`searchTerm: ${searchTerm}`);
        // Check cache first
        console.log("addSong: Emitting user:checkCache");
        socket.emit('user:checkCache', { searchTerm }, async (response) => {
            console.log("addSong: checkCache callback fired with response:", response);
            let playable;
            if (response.videoId) {
                console.log('Found cached video');
                const isStillPlayable = await checkVideo(response.videoId);
                if (isStillPlayable) {
                    console.log('Cached video is still playable, adding song');
                    playable = response.videoId;
                    socket.emit('user:addSong', {
                        code: roomCode,
                        userId,
                        title: title,
                        artists: artists,
                        videoId: playable,
                        albumImage,
                    });
                    setResults([]);
                    setSearchTerm("");
                    setAdding(false);
                    return;
                }
                else {
                    console.log('Cached video no longer playable, falling back to search');
                }
            }
            // Cache miss or cached video not playable - use existing logic
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(searchTerm)}`);
            if (!res.ok) {
                console.warn(`Fetch error: ${res.status}`);
                setAdding(false);
                return;
            }
            console.log("Searched YT");
            const data = await res.json();
            const videos = data.videos;
            if (!videos.length) {
                console.warn('No videos found');
                setAdding(false);
                return;
            }
            console.log("Trying videos");
            try {
                playable = await findVideo(videos);
                socket.emit('user:cacheVideo', { searchTerm, videoId: playable });
            }
            catch (err) {
                console.warn('No playable videos found', err);
                setAdding(false);
                return;
            }
            socket.emit('user:addSong', {
                code: roomCode,
                userId,
                title: title,
                artists: artists,
                videoId: playable,
                albumImage,
            });
            setResults([]);
            setSearchTerm("");
            setAdding(false);
        });
    };
    // Remove song from queue
    const removeSong = async (songId) => {
        socket.emit('user:removeSong', { code: roomCode, songId });
    };
    // User leaves room
    const leaveRoom = async () => {
        socket.emit('user:leaveRoom', { code: roomCode, userId });
        onExit();
    };
    return (_jsxs("div", { children: [_jsx("button", { className: "leave-room", onClick: leaveRoom, children: " Leave Room " }), _jsxs("h2", { children: ["What do you want to sing, ", name, "?"] }), _jsxs("form", { action: search, className: "search-bar", children: [_jsx("input", { value: searchTerm, onChange: (e) => setSearchTerm(e.target.value), placeholder: "Search song" }), _jsx("button", { onClick: search, children: _jsx(Search, { size: 24 }) })] }), loading ? (_jsx("div", { className: "spinner" })) : (_jsx("ul", { children: results.map((r) => (_jsxs("li", { className: "song-card", children: [_jsx("img", { className: "album", src: r.albumImage }), _jsxs("div", { className: "track-text", children: [_jsx("p", { className: "track-name", children: r.trackName }), _jsx("p", { className: "artists", children: r.artists.join(', ') })] }), _jsx("button", { onClick: () => addSong(r.trackName, r.artists, r.albumImage), disabled: adding, children: _jsx(Plus, { size: 24 }) })] }, r.trackId))) })), _jsx("h3", { children: "Your Queue" }), _jsx("ul", { children: queue.slice(1).filter(q => q.requestedBy === userId).map((q) => (_jsxs("li", { className: "song-card", children: [_jsx("img", { className: "album", src: q.albumImage }), _jsxs("div", { className: "track-text", children: [_jsx("p", { className: "track-name", children: q.title }), _jsx("p", { className: "artists", children: q.artists.join(', ') })] }), _jsx("button", { onClick: () => removeSong(q.id), children: _jsx(Minus, { size: 24 }) })] }, q.id))) }), _jsx("h3", { children: "Global Queue" }), _jsx("ul", { children: queue.slice(1).map((q) => (_jsxs("li", { className: "song-card", children: [_jsx("img", { className: "album", src: q.albumImage }), _jsxs("div", { className: "track-text", children: [_jsx("p", { className: "track-name", children: q.title }), _jsx("p", { className: "artists", children: q.artists.join(', ') })] })] }, q.id))) })] }));
}
