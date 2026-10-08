"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createWatchSyncSocket } from "@/lib/socket";
import ThemeToggle, { useTheme } from "@/components/theme-toggle";

function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (window.watchSyncYouTubeApi) return window.watchSyncYouTubeApi;
    window.watchSyncYouTubeApi = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
        const previousReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            previousReady?.();
            resolve(window.YT);
        };
        if (!existingScript) {
            const script = document.createElement("script");
            script.src = "https://www.youtube.com/iframe_api";
            script.onerror = reject;
            document.head.appendChild(script);
        }
    });
    return window.watchSyncYouTubeApi;
}

const demoParticipants = [
    { name: "You", role: "HOST" },
    { name: "Waiting for friends", role: "PARTICIPANT" },
];

function RoomContent({ params }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [roomId, setRoomId] = useState("");
    const [activeTab, setActiveTab] = useState("participants");
    const [message, setMessage] = useState("");
    const [chat, setChat] = useState([]);
    const [videoId, setVideoId] = useState("");
    const [videoInput, setVideoInput] = useState("");
    const [showVideoForm, setShowVideoForm] = useState(false);
    const [reactions, setReactions] = useState([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [connection, setConnection] = useState("connecting");
    const [roomStatus, setRoomStatus] = useState("loading");
    const [roomError, setRoomError] = useState("");
    const [joinName, setJoinName] = useState("");
    const [joinMode, setJoinMode] = useState("join");
    const [roomRole, setRoomRole] = useState("");
    const [selfUserId, setSelfUserId] = useState("");
    const [joinError, setJoinError] = useState("");
    const [liveParticipants, setLiveParticipants] = useState([]);
    const [toast, setToast] = useState("");
    const [showEndRoomPrompt, setShowEndRoomPrompt] = useState(false);
    const theme = useTheme("dark");
    const socketRef = useRef(null);
    const videoStageRef = useRef(null);
    const playerContainerRef = useRef(null);
    const playerRef = useRef(null);
    const canControlRef = useRef(false);
    const applyingRemotePlaybackRef = useRef(false);
    const playbackStateRef = useRef({ playState: "paused", currentTime: 0, updatedAt: 0 });
    const lastObservedTimeRef = useRef(0);
    const toastTimeoutRef = useRef(null);
    const roomVerificationCompleteRef = useRef(false);

    useEffect(() => {
        Promise.resolve(params).then((value) => setRoomId(value.roomId));
    }, [params]);

    useEffect(() => {
        const queryName = searchParams.get("name");
        const queryMode = searchParams.get("mode");
        if (!queryName && !queryMode) return;
        if (queryName && (queryMode === "create" || queryMode === "join")) {
            window.sessionStorage.setItem("watchsync-pending-join", JSON.stringify({ name: queryName, mode: queryMode }));
        }
        router.replace(`/room/${searchParams.get("roomId") || window.location.pathname.split("/").pop()}`);
    }, [router, searchParams]);

    const name = joinName || "Guest";
    const mode = joinMode;
    const isHost = roomRole === "HOST";
    const canControl = roomRole === "HOST" || roomRole === "MODERATOR";
    const participants = liveParticipants.length > 0 ? liveParticipants : (isHost ? demoParticipants : [{ name, role: "PARTICIPANT" }]);

    useEffect(() => {
        canControlRef.current = canControl;
    }, [canControl, isHost]);

    const readPendingJoin = useCallback(() => {
        const rawPendingJoin = window.sessionStorage.getItem("watchsync-pending-join");
        if (!rawPendingJoin) return null;
        try {
            const pendingJoin = JSON.parse(rawPendingJoin);
            if (pendingJoin.roomId === roomId && pendingJoin.name && (pendingJoin.mode === "create" || pendingJoin.mode === "join")) return pendingJoin;
        } catch (error) {
            console.error("Unable to read pending room join", error);
        }
        window.sessionStorage.removeItem("watchsync-pending-join");
        return null;
    }, [roomId]);

    const readActiveSession = useCallback(() => {
        const rawSession = window.sessionStorage.getItem(`watchsync-room-${roomId}`);
        if (!rawSession) return null;
        try {
            const activeSession = JSON.parse(rawSession);
            if (activeSession.roomId === roomId && activeSession.name && (activeSession.mode === "create" || activeSession.mode === "join")) return activeSession;
        } catch (error) {
            console.error("Unable to read active room session", error);
        }
        window.sessionStorage.removeItem(`watchsync-room-${roomId}`);
        return null;
    }, [roomId]);

    const saveActiveSession = useCallback((session) => {
        window.sessionStorage.setItem(`watchsync-room-${roomId}`, JSON.stringify({ ...session, roomId }));
    }, [roomId]);

    const clearRoomSession = useCallback(() => {
        window.sessionStorage.removeItem(`watchsync-room-${roomId}`);
        window.sessionStorage.removeItem("watchsync-pending-join");
    }, [roomId]);

    function applyPlaybackUpdate(action, currentTime) {
        const player = playerRef.current;
        if (!player) return;
        applyingRemotePlaybackRef.current = true;
        if (action === "seek") player.seekTo(currentTime, true);
        if (action === "play") player.playVideo();
        if (action === "pause") player.pauseVideo();
        setCurrentTime(currentTime);
        window.setTimeout(() => {
            applyingRemotePlaybackRef.current = false;
            lastObservedTimeRef.current = currentTime;
        }, 700);
    }

    useEffect(() => {
        if (!roomId) return undefined;
        const socket = createWatchSyncSocket();
        socketRef.current = socket;
        const onConnect = () => {
            setConnection("connected");
            const session = readPendingJoin() || readActiveSession();
            if (session?.mode === "create") {
                const sessionId = session.sessionId || crypto.randomUUID();
                setJoinName(session.name);
                setJoinMode("create");
                saveActiveSession({ name: session.name, mode: session.mode, sessionId });
                socket.emit("create_room", { roomId, sessionId });
                return;
            }
            socket.emit("check_room", { roomId });
        };
        const onDisconnect = () => setConnection("reconnecting");
        const onParticipants = (payload) => setLiveParticipants(payload.participants || []);
        const onRoleAssigned = (payload = {}) => {
            setLiveParticipants(payload.participants || []);
            if (payload.userId === socket.id) setRoomRole(payload.role || "PARTICIPANT");
            if (payload.userId === socket.id) {
                const session = readActiveSession();
                if (session) saveActiveSession({ ...session, role: payload.role });
            }
            setToast(payload.userId === socket.id ? `You are now ${payload.role.toLowerCase()}` : `${payload.username} is now ${payload.role.toLowerCase()}`);
        };
        const onParticipantRemoved = () => {
            clearRoomSession();
            socket.disconnect();
            router.push("/");
        };
        const onRoomEnded = () => {
            clearRoomSession();
            router.push("/");
        };
        const onRoomAvailable = (payload = {}) => {
            roomVerificationCompleteRef.current = true;
            const nextJoin = readPendingJoin() || readActiveSession();
            if (nextJoin) {
                const sessionId = nextJoin.sessionId || crypto.randomUUID();
                setJoinName(nextJoin.name);
                setJoinMode(nextJoin.mode);
                saveActiveSession({ ...nextJoin, sessionId });
                window.sessionStorage.removeItem("watchsync-pending-join");
                socket.emit("join_room", { roomId, username: nextJoin.name, mode: nextJoin.mode, sessionId });
            } else {
                setRoomStatus("join");
            }
        };
        const onSocketError = (payload) => {
            if (payload?.code === "ROOM_NOT_FOUND") {
                roomVerificationCompleteRef.current = true;
                setRoomStatus("not-found");
                socket.disconnect();
                return;
            }
            roomVerificationCompleteRef.current = true;
            setRoomError(payload?.message || "The room could not be verified.");
            setRoomStatus("error");
        };
        const onSyncState = (payload = {}) => {
            roomVerificationCompleteRef.current = true;
            setChat(Array.isArray(payload.chat) ? payload.chat : []);
            setVideoId(payload.videoId || "");
            setRoomRole(payload.selfRole || "PARTICIPANT");
            setSelfUserId(payload.selfUserId || socket.id);
            playbackStateRef.current = {
                playState: payload.playState || "paused",
                currentTime: Number(payload.currentTime) || 0,
                updatedAt: Number(payload.updatedAt) || Date.now(),
            };
            setCurrentTime(playbackStateRef.current.currentTime);
            setIsPlaying(payload.playState === "playing");
            const session = readPendingJoin() || readActiveSession();
            if (session) saveActiveSession(session);
            setRoomStatus("ready");
        };
        const onNewMessage = (chatMessage) => {
            if (!chatMessage?.id || !chatMessage.name || !chatMessage.text) return;
            setChat((current) => {
                if (current.some((item) => item.id === chatMessage.id)) return current;
                return [...current, chatMessage].slice(-100);
            });
        };
        const onVideoUpdated = ({ videoId: nextVideoId } = {}) => {
            setVideoId(nextVideoId || "");
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(0);
            playbackStateRef.current = { playState: "paused", currentTime: 0, updatedAt: Date.now() };
        };
        const onPlaybackUpdated = ({ action, currentTime, updatedAt } = {}) => {
            playbackStateRef.current = {
                playState: action === "play" ? "playing" : action === "pause" ? "paused" : playbackStateRef.current.playState,
                currentTime: Number(currentTime) || 0,
                updatedAt: Number(updatedAt) || Date.now(),
            };
            setCurrentTime(playbackStateRef.current.currentTime);
            setIsPlaying(playbackStateRef.current.playState === "playing");
            applyPlaybackUpdate(action, Number(currentTime) || 0);
        };
        const onRoomReaction = (reaction) => {
            if (!reaction?.id || !reaction.emoji) return;
            setReactions((current) => [...current, reaction].slice(-12));
            window.setTimeout(() => setReactions((current) => current.filter((item) => item.id !== reaction.id)), 2600);
        };
        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        socket.on("error", onSocketError);
        socket.on("room_not_found", onSocketError);
        socket.on("room_available", onRoomAvailable);
        socket.on("sync_state", onSyncState);
        socket.on("new_message", onNewMessage);
        socket.on("video_updated", onVideoUpdated);
        socket.on("playback_updated", onPlaybackUpdated);
        socket.on("room_reaction", onRoomReaction);
        socket.on("role_assigned", onRoleAssigned);
        socket.on("participant_removed", onParticipantRemoved);
        socket.on("user_joined", onParticipants);
        socket.on("user_left", onParticipants);
        socket.on("room_ended", onRoomEnded);
        socket.connect();
        const verificationTimeout = setTimeout(() => {
            if (!roomVerificationCompleteRef.current) {
                roomVerificationCompleteRef.current = true;
                setRoomError("The room server did not respond. Please try again.");
                setRoomStatus("error");
                socket.disconnect();
            }
        }, 8000);
        return () => {
            clearTimeout(verificationTimeout);
            socket.disconnect();
            socketRef.current = null;
            roomVerificationCompleteRef.current = false;
        };
    }, [clearRoomSession, readActiveSession, readPendingJoin, roomId, router, saveActiveSession]);

    function emitPlaybackAction(action, currentTime) {
        socketRef.current?.emit("playback_action", { action, currentTime });
    }

    function disableYouTubeCaptions(player) {
        if (typeof player?.unloadModule !== "function") return;
        player.unloadModule("captions");
    }

    useEffect(() => {
        if (!videoId || !playerContainerRef.current) return undefined;
        let cancelled = false;
        let pollTimer;
        loadYouTubeApi().then((YT) => {
            if (cancelled || !playerContainerRef.current) return;
            const options = {
                videoId,
                playerVars: {
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    iv_load_policy: 3,
                    cc_load_policy: 0,
                    modestbranding: 1,
                    rel: 0,
                    playsinline: 1,
                },
                events: {
                    onReady: (event) => {
                        const playback = playbackStateRef.current;
                        const synchronizedTime = playback.playState === "playing"
                            ? playback.currentTime + (Date.now() - playback.updatedAt) / 1000
                            : playback.currentTime;
                        disableYouTubeCaptions(event.target);
                        setDuration(event.target.getDuration() || 0);
                        event.target.seekTo(Math.max(0, synchronizedTime), true);
                        setCurrentTime(Math.max(0, synchronizedTime));
                        applyingRemotePlaybackRef.current = true;
                        if (playback.playState === "playing") event.target.playVideo();
                        else event.target.pauseVideo();
                        window.setTimeout(() => {
                            applyingRemotePlaybackRef.current = false;
                        }, 700);
                        lastObservedTimeRef.current = synchronizedTime;
                    },
                    onApiChange: (event) => disableYouTubeCaptions(event.target),
                    onStateChange: (event) => {
                        const player = event.target;
                        const currentTime = player.getCurrentTime();
                        setCurrentTime(currentTime);
                        lastObservedTimeRef.current = currentTime;
                        if (applyingRemotePlaybackRef.current) return;
                        if (!canControlRef.current) return;
                        if (event.data === YT.PlayerState.PLAYING) {
                            setIsPlaying(true);
                            emitPlaybackAction("play", currentTime);
                        } else if (event.data === YT.PlayerState.PAUSED) {
                            setIsPlaying(false);
                            emitPlaybackAction("pause", currentTime);
                        }
                    },
                },
            };
            playerRef.current = new YT.Player(playerContainerRef.current, options);
            pollTimer = window.setInterval(() => {
                const player = playerRef.current;
                if (!canControlRef.current) return;
                if (!player || applyingRemotePlaybackRef.current || typeof player.getPlayerState !== "function") return;
                if (player.getPlayerState() !== YT.PlayerState.PLAYING && player.getPlayerState() !== YT.PlayerState.PAUSED) return;
                const currentTime = player.getCurrentTime();
                setCurrentTime(currentTime);
                if (Math.abs(currentTime - lastObservedTimeRef.current) > 1.5) {
                    lastObservedTimeRef.current = currentTime;
                    playbackStateRef.current.currentTime = currentTime;
                    emitPlaybackAction("seek", currentTime);
                } else {
                    lastObservedTimeRef.current = currentTime;
                }
            }, 300);
        }).catch((error) => console.error("Unable to load YouTube player", error));
        return () => {
            cancelled = true;
            window.clearInterval(pollTimer);
            playerRef.current?.destroy();
            playerRef.current = null;
        };
    }, [videoId]);

    useEffect(() => () => clearTimeout(toastTimeoutRef.current), []);

    useEffect(() => {
        if (!showEndRoomPrompt) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === "Escape") setShowEndRoomPrompt(false);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [showEndRoomPrompt]);

    async function copyRoomLink() {
        try {
            if (!navigator.clipboard) {
                throw new Error("Clipboard access is unavailable");
            }
            await navigator.clipboard.writeText(window.location.href);
            setToast("Link copied");
            clearTimeout(toastTimeoutRef.current);
            toastTimeoutRef.current = setTimeout(() => setToast(""), 2500);
        } catch (error) {
            console.error("Unable to copy room link", error);
            setToast("Could not copy link");
            clearTimeout(toastTimeoutRef.current);
            toastTimeoutRef.current = setTimeout(() => setToast(""), 2500);
        }
    }

    function handleRoomExit() {
        if (isHost) {
            setShowEndRoomPrompt(true);
            return;
        } else {
            socketRef.current?.emit("leave_room");
        }
        clearRoomSession();
        router.push("/");
    }

    function endRoom() {
        socketRef.current?.emit("end_room");
        clearRoomSession();
        setShowEndRoomPrompt(false);
        router.push("/");
    }

    function sendMessage(event) {
        event.preventDefault();
        const cleanMessage = message.trim();
        if (!cleanMessage) return;
        socketRef.current?.emit("send_message", { text: cleanMessage });
        setMessage("");
    }

    function extractVideoId(value) {
        const match = value.trim().match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/))([\w-]{11})/i);
        return match ? match[1] : (/^[\w-]{11}$/.test(value.trim()) ? value.trim() : "");
    }

    function chooseVideo(event) {
        event.preventDefault();
        if (!canControl) return;
        const nextVideoId = extractVideoId(videoInput);
        if (!nextVideoId) {
            setToast("Paste a valid YouTube link");
            return;
        }
        socketRef.current?.emit("set_video", { videoId: nextVideoId });
        setShowVideoForm(false);
        setVideoInput("");
    }

    function sendReaction(emoji) {
        socketRef.current?.emit("send_reaction", { emoji });
    }

    function assignRole(userId, role) {
        socketRef.current?.emit("assign_role", { userId, role });
    }

    function removeParticipant(userId) {
        socketRef.current?.emit("remove_participant", { userId });
    }

    function togglePlayback() {
        if (!canControl || !playerRef.current || !videoId) return;
        const currentTime = playerRef.current.getCurrentTime();
        if (isPlaying) playerRef.current.pauseVideo();
        else playerRef.current.playVideo();
        emitPlaybackAction(isPlaying ? "pause" : "play", currentTime);
    }

    function seekVideo(event) {
        if (!canControl || !playerRef.current) return;
        const nextTime = Number(event.target.value);
        playerRef.current.seekTo(nextTime, true);
        setCurrentTime(nextTime);
        playbackStateRef.current.currentTime = nextTime;
        emitPlaybackAction("seek", nextTime);
    }

    function toggleMute() {
        const player = playerRef.current;
        if (!player) return;
        if (isMuted) player.unMute();
        else player.mute();
        setIsMuted(!isMuted);
    }

    async function toggleFullscreen() {
        const fullscreenTarget = videoStageRef.current;
        if (!fullscreenTarget) return;
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                return;
            }
            const requestFullscreen = fullscreenTarget.requestFullscreen || fullscreenTarget.webkitRequestFullscreen;
            if (typeof requestFullscreen !== "function") {
                setToast("Fullscreen is not supported in this browser");
                return;
            }
            await requestFullscreen.call(fullscreenTarget);
        } catch (error) {
            console.error("Unable to enter fullscreen", error);
            setToast("Fullscreen was blocked by the browser");
            clearTimeout(toastTimeoutRef.current);
            toastTimeoutRef.current = setTimeout(() => setToast(""), 2500);
        }
    }

    function formatTime(value) {
        const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, "0");
        return `${minutes}:${seconds}`;
    }

    function joinRoom(event) {
        event.preventDefault();
        const cleanName = joinName.trim();
        if (!cleanName) {
            setJoinError("Enter your name to join this room.");
            return;
        }
        setJoinError("");
        const sessionId = crypto.randomUUID();
        saveActiveSession({ name: cleanName, mode: "join", sessionId });
        socketRef.current?.emit("join_room", { roomId, username: cleanName, mode: "join", sessionId });
        setRoomStatus("joining");
    }

    if (roomStatus === "not-found") {
        return (
            <main className="missing-shell">
                <div className="missing-code">404</div>
                <p className="eyebrow"><span /> Room not found</p>
                <h1>Room not<br /><em>found.</em></h1>
                <p className="missing-copy">This room does not exist or has ended.</p>
                <button className="primary-action missing-action" onClick={() => router.push("/")} type="button">Back to watchsync <span>↗</span></button>
            </main>
        );
    }

    if (roomStatus === "loading") {
        return <main className="room-loading">Checking room...</main>;
    }

    if (roomStatus === "error") {
        return (
            <main className="missing-shell">
                <div className="missing-code">ERROR</div>
                <p className="eyebrow"><span /> Room unavailable</p>
                <h1>Couldn&apos;t check<br /><em>this room.</em></h1>
                <p className="missing-copy">Please try again.</p>
                <button className="primary-action missing-action" onClick={() => window.location.reload()} type="button">Try again <span>↗</span></button>
            </main>
        );
    }

    if (roomStatus === "join" || roomStatus === "joining") {
        return (
            <main className={`landing-shell theme-${theme}`}>
                <section className="room-join-card" aria-labelledby="join-room-title">
                    <span className="confirmation-icon">↗</span>
                    <p className="confirmation-kicker">You&apos;ve been invited</p>
                    <h1 id="join-room-title">Join room<br /><em>{roomId}</em></h1>
                    <p className="missing-copy">Enter your name before joining this private watch room.</p>
                    <form onSubmit={joinRoom}>
                        <label>Your name<input value={joinName} onChange={(event) => { setJoinName(event.target.value); setJoinError(""); }} placeholder="What should we call you?" maxLength={32} autoFocus /></label>
                        {joinError && <p className="form-error" role="alert">{joinError}</p>}
                        <button className="primary-action" disabled={roomStatus === "joining"} type="submit">{roomStatus === "joining" ? "Joining..." : "Join room"}<span>↗</span></button>
                    </form>
                </section>
            </main>
        );
    }

    return (
        <main className={`room-shell theme-${theme}${showEndRoomPrompt ? " modal-open" : ""}`}>
            <header className="room-header">
                <button className="room-brand" onClick={() => router.push("/")} type="button"><span className="brand-dot" />watchsync</button>
                <div className="room-heading"><span>Watch room</span><strong>{roomId || "..."}</strong></div>
                <div className="room-actions"><ThemeToggle defaultTheme={theme} /><button className="copy-button" type="button" onClick={copyRoomLink}>Copy link</button><button className="leave-button" onClick={handleRoomExit} type="button">{isHost ? "End room" : "Leave"}</button></div>
            </header>

            <section className="room-layout">
                <div className="player-column">
                    <div ref={videoStageRef} className="video-stage">
                        {videoId ? <div ref={playerContainerRef} className={`video-frame${canControl ? "" : " participant-video"}`} aria-label="Shared YouTube video">{!canControl && <span className="participant-video-shield" aria-hidden="true" />}{canControl && <button className="video-play-overlay" type="button" aria-label={isPlaying ? "Pause shared video" : "Play shared video"} onClick={togglePlayback} />}</div> : <div className={`video-placeholder${canControl ? "" : " participant-placeholder"}`}><div className="play-symbol" aria-hidden="true">{canControl ? "▶" : "•"}</div><p>{canControl ? "Choose a video to begin" : "Waiting for the host or moderator"}</p><span>{canControl ? "Paste a YouTube link from the room controls" : "They will choose a video for everyone to watch"}</span></div>}
                        <div className="reaction-popups" aria-live="polite">{reactions.map((reaction) => <span key={reaction.id} title={`${reaction.name} reacted`}>{reaction.emoji}</span>)}</div>
                    </div>
                    <div className={`player-bar${canControl ? "" : " participant-player-bar"}`}>
                        {canControl && <button className="control-button" type="button" aria-label={isPlaying ? "Pause video" : "Play video"} onClick={togglePlayback} disabled={!videoId}>{isPlaying ? "Ⅱ" : "▶"}</button>}
                        {canControl && <input className="timeline" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(currentTime, duration || 1)} onChange={seekVideo} aria-label="Seek video" disabled={!videoId || !duration} />}
                        <span className="timecode">{!videoId && !canControl ? "Waiting for host or moderator" : `${formatTime(currentTime)} / ${duration ? formatTime(duration) : "--:--"}`}</span>
                        {canControl && <button className="control-button faint volume-button" type="button" aria-label={isMuted ? "Unmute video" : "Mute video"} onClick={toggleMute} disabled={!videoId}>
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                                <path d="M4 9v6h4l5 4V5L8 9H4Z" />
                                <path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" />
                            </svg>
                        </button>}
                        <button className="control-button faint" type="button" aria-label="Fullscreen" onClick={toggleFullscreen} disabled={!videoId}>⛶</button>
                    </div>
                    <div className="video-tools"><span>{canControl ? "You can control shared playback" : "Shared playback is controlled by the host and moderators"}</span>{canControl && <button type="button" onClick={() => setShowVideoForm((current) => !current)}>Change video <b>↗</b></button>}</div>
                    {showVideoForm && canControl && <form className="video-form" onSubmit={chooseVideo}><input value={videoInput} onChange={(event) => setVideoInput(event.target.value)} placeholder="Paste a YouTube link" aria-label="YouTube video link" /><button type="submit">Load</button></form>}
                </div>

                <aside className="room-sidebar">
                    <div className="sidebar-tabs" role="tablist">
                        <button className={activeTab === "participants" ? "active" : ""} onClick={() => setActiveTab("participants")} type="button">People <span>{participants.length}</span></button>
                        <button className={activeTab === "chat" ? "active" : ""} onClick={() => setActiveTab("chat")} type="button">Live chat</button>
                    </div>
                    <div className={`quick-reactions${!videoId ? " reactions-disabled" : ""}`} aria-label="Quick reactions"><span>React</span>{["❤️", "😂", "👏", "🔥", "😮"].map((emoji) => <button key={emoji} type="button" onClick={() => sendReaction(emoji)} aria-label={`Send ${emoji} reaction`} disabled={!videoId}>{emoji}</button>)}</div>
                    {activeTab === "participants" ? <div className="participant-content"><div className="sidebar-title"><h2>In this room</h2><span>{participants.length} online</span></div><div className="participant-list">{participants.map((participant) => { const participantName = participant.name || participant.username; const canManage = isHost && participant.userId && participant.userId !== selfUserId && participant.role !== "HOST"; return <div className="participant" key={participant.userId || participantName}><span className={`avatar ${participant.role.toLowerCase()}`}>{participantName.slice(0, 1).toUpperCase()}</span><div><strong>{participantName}</strong><small>{participant.role}</small></div>{participant.role === "HOST" && <span className="host-mark">HOST</span>}{participant.role === "MODERATOR" && <span className="host-mark">MOD</span>}{canManage && <div className="participant-actions"><button type="button" onClick={() => assignRole(participant.userId, participant.role === "MODERATOR" ? "PARTICIPANT" : "MODERATOR")} aria-label={`${participant.role === "MODERATOR" ? "Remove moderator role from" : "Make"} ${participantName} ${participant.role === "MODERATOR" ? "" : "moderator"}`}>{participant.role === "MODERATOR" ? "Demote" : "Mod"}</button><button type="button" onClick={() => removeParticipant(participant.userId)} aria-label={`Remove ${participantName}`}>Remove</button></div>}</div>; })}</div><div className="request-hint"><span>↗</span><div><strong>Moderators can control playback</strong><p>Only the host can manage roles or remove participants.</p></div></div></div> : <div className="chat-content"><div className="sidebar-title"><h2>Room chat</h2><span>Live</span></div><div className="chat-messages" aria-live="polite">{chat.length === 0 && <p className="empty-chat">Say hello when everyone arrives.</p>}{chat.map((item) => <div className="chat-message" key={item.id || `${item.name}-${item.text}`}><strong>{item.name}</strong><p>{item.text}</p></div>)}</div><form className="chat-form" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message..." maxLength={500} /><button type="submit" aria-label="Send message">↗</button></form></div>}
                    <div className="sidebar-footer"><span className={`connection-dot ${connection !== "connected" ? "offline" : ""}`} /> {connection === "connected" ? "Connected as" : "Reconnecting"} <strong>{name}</strong></div>
                </aside>
            </section>
            {toast && <div className="room-toast" role="status" aria-live="polite">{toast}</div>}
            {showEndRoomPrompt && <div className="room-confirmation-backdrop" onClick={() => setShowEndRoomPrompt(false)}>
                <section className="room-confirmation" role="dialog" aria-modal="true" aria-labelledby="end-room-title" onClick={(event) => event.stopPropagation()}>
                    <button className="confirmation-close" type="button" aria-label="Close confirmation" onClick={() => setShowEndRoomPrompt(false)}>×</button>
                    <span className="confirmation-icon">!</span>
                    <p className="confirmation-kicker">End watch room</p>
                    <h2 id="end-room-title">End this room for everyone?</h2>
                    <p className="confirmation-copy">Everyone will be disconnected and this room link will no longer work.</p>
                    <div className="confirmation-room"><span>ROOM</span><strong>{roomId || "..."}</strong></div>
                    <div className="confirmation-actions">
                        <button className="confirmation-cancel" type="button" onClick={() => setShowEndRoomPrompt(false)}>Keep room</button>
                        <button className="confirmation-end" type="button" onClick={endRoom}>End room</button>
                    </div>
                </section>
            </div>}
        </main>
    );
}

export default function RoomPage({ params }) {
    return (
        <Suspense fallback={<main className="room-loading">Opening room...</main>}>
            <RoomContent params={params} />
        </Suspense>
    );
}
