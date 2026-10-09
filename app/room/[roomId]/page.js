"use client";

import React, { Suspense, useState, useEffect, useLayoutEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createWatchSyncSocket } from "@/lib/socket";

function extractYouTubeVideoId(value) {
  const input = value.trim();
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (hostname === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
    else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostname)) {
      id = url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] || "";
    }
    return /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (window.watchSyncYouTubeApiPromise) return window.watchSyncYouTubeApiPromise;
  window.watchSyncYouTubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve(window.YT);
    };
    let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("The YouTube player could not be loaded."));
      document.head.appendChild(script);
    }
  }).catch((error) => {
    window.watchSyncYouTubeApiPromise = null;
    throw error;
  });
  return window.watchSyncYouTubeApiPromise;
}

function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = String(params?.roomId || "").trim().toUpperCase();
  const [identity, setIdentity] = useState(null);
  const [joinName, setJoinName] = useState("");
  const [showJoinPrompt, setShowJoinPrompt] = useState(false);
  const [joinPromptError, setJoinPromptError] = useState("");
  const [selfRole, setSelfRole] = useState("PARTICIPANT");
  const [participants, setParticipants] = useState([]);
  const [connectionState, setConnectionState] = useState("connecting");
  const currentUserRole = selfRole;
  const canStartVideo = currentUserRole === "HOST" || currentUserRole === "MODERATOR";
  const [isDark, setIsDark] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTab, setCurrentTab] = useState("chat");
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoId, setVideoId] = useState(null);
  const [hasHostStartedVideo, setHasHostStartedVideo] = useState(false);
  const [videoModalMode, setVideoModalMode] = useState("replace");
  const [toast, setToast] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [queueList, setQueueList] = useState([]);

  const socketRef = useRef(null);
  const youtubeMountRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const initialRoomStateRef = useRef(null);
  const queueListRef = useRef(queueList);
  const userRoleRef = useRef(currentUserRole);
  const volumeRef = useRef(volume);
  const toastCallbackRef = useRef(null);
  queueListRef.current = queueList;
  userRoleRef.current = currentUserRole;
  volumeRef.current = volume;
  const chatAnchorRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const videoStageRef = useRef(null);
  const roomTabsRef = useRef(null);
  const roomTabContentRefs = useRef({});
  const [tabCapsuleStyle, setTabCapsuleStyle] = useState({ left: 0, top: 0, width: 0, height: 0 });

  useLayoutEffect(() => {
    const tabs = roomTabsRef.current;
    const content = roomTabContentRefs.current[currentTab];
    if (!tabs || !content) return;

    const updateCapsulePosition = () => {
      const tabsRect = tabs.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const horizontalInset = 14;
      const verticalInset = 8;
      const contentRects = Object.values(roomTabContentRefs.current)
        .filter(Boolean)
        .map((node) => node.getBoundingClientRect());
      const capsuleWidth = Math.max(...contentRects.map((rect) => rect.width)) + horizontalInset * 2;
      const capsuleHeight = Math.max(...contentRects.map((rect) => rect.height)) + verticalInset * 2;
      setTabCapsuleStyle({
        left: contentRect.left - tabsRect.left + contentRect.width / 2 - capsuleWidth / 2,
        top: contentRect.top - tabsRect.top - verticalInset,
        width: capsuleWidth,
        height: capsuleHeight,
      });
    };

    updateCapsulePosition();
    const observer = new ResizeObserver(updateCapsulePosition);
    observer.observe(tabs);
    Object.values(roomTabContentRefs.current).filter(Boolean).forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [currentTab]);

  const showToastMsg = (msg) => {
    setToast(msg);
    clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(""), 2500);
  };
  toastCallbackRef.current = showToastMsg;

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let socket;
    try {
      const stored = window.sessionStorage.getItem(`watchsync-room-${roomId}`);
      const roomIdentity = stored ? JSON.parse(stored) : identity;
      if (!roomIdentity?.name || roomIdentity.roomId !== roomId) {
        setShowJoinPrompt(true);
        return;
      }
      if (!identity) {
        setIdentity(roomIdentity);
        return () => { cancelled = true; };
      }
      setShowJoinPrompt(false);
      if (!roomIdentity.sessionId) roomIdentity.sessionId = window.crypto.randomUUID();
      window.sessionStorage.setItem(`watchsync-room-${roomId}`, JSON.stringify(roomIdentity));
      socket = createWatchSyncSocket();
      socketRef.current = socket;

      const joinRoom = () => socket.emit("join_room", {
        roomId,
        username: roomIdentity.name,
        mode: roomIdentity.mode,
        sessionId: roomIdentity.sessionId,
      });
      const onConnect = () => {
        if (cancelled) return;
        setConnectionState("connected");
        joinRoom();
      };
      const onDisconnect = () => setConnectionState("reconnecting");
      const onConnectionError = () => {
        setConnectionState("offline");
        toastCallbackRef.current?.("The realtime service is unavailable. Room controls and chat need a connection.");
      };
      const onSyncState = (state) => {
        initialRoomStateRef.current = state;
        setSelfRole(state.selfRole || "PARTICIPANT");
        setParticipants(state.participants || []);
        setChatMessages(state.chat || []);
        setQueueList(state.queue || []);
        setVideoId(state.videoId || null);
        setHasHostStartedVideo(Boolean(state.videoId));
        setCurrentTime(Number(state.currentTime) || 0);
        setIsPlaying(state.playState === "playing");
      };
      const onParticipants = ({ participants: nextParticipants = [] } = {}) => setParticipants(nextParticipants);
      const onMessage = (message) => setChatMessages((current) => current.some((entry) => entry.id === message.id) ? current : [...current, message]);
      const onRoleAssigned = ({ userId, role, participants: nextParticipants = [] } = {}) => {
        setParticipants(nextParticipants);
        if (socket.id === userId) setSelfRole(role);
      };
      const onVideoUpdated = ({ videoId: nextVideoId, currentTime: nextTime = 0, playState } = {}) => {
        initialRoomStateRef.current = { ...(initialRoomStateRef.current || {}), videoId: nextVideoId, currentTime: nextTime, playState: playState || "paused" };
        setVideoId(nextVideoId || null);
        setHasHostStartedVideo(Boolean(nextVideoId));
        setCurrentTime(Number(nextTime) || 0);
        if (playState) setIsPlaying(playState === "playing");
      };
      const onPlaybackUpdated = ({ action, currentTime: nextTime } = {}) => {
        const player = youtubePlayerRef.current;
        const seekTo = Number(nextTime) || 0;
        initialRoomStateRef.current = { ...(initialRoomStateRef.current || {}), currentTime: seekTo, playState: action === "play" ? "playing" : action === "pause" ? "paused" : initialRoomStateRef.current?.playState };
        setCurrentTime(seekTo);
        if (action === "play") {
          setIsPlaying(true);
          player?.seekTo(seekTo, true);
          player?.playVideo();
        } else if (action === "pause") {
          setIsPlaying(false);
          player?.seekTo(seekTo, true);
          player?.pauseVideo();
        } else if (action === "seek") {
          player?.seekTo(seekTo, true);
        }
      };
      const onQueueUpdated = ({ queue = [] } = {}) => setQueueList(queue);
      const onReaction = ({ id, emoji, name } = {}) => {
        const reactionId = id || `${Date.now()}-${Math.random()}`;
        setReactions((current) => [...current, { id: reactionId, emoji, name, offsetRight: 14 + Math.floor(Math.random() * 38) }]);
        window.setTimeout(() => setReactions((current) => current.filter((reaction) => reaction.id !== reactionId)), 1800);
      };
      const onRemoved = () => {
        window.sessionStorage.removeItem(`watchsync-room-${roomId}`);
        socket.disconnect();
        router.replace(`/?room=${encodeURIComponent(roomId)}`);
      };
      const onEnded = () => {
        window.sessionStorage.removeItem(`watchsync-room-${roomId}`);
        socket.disconnect();
        router.replace("/");
      };
      const onRoomError = (error) => toastCallbackRef.current?.(error?.message || "A room action could not be completed.");

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectionError);
      socket.on("sync_state", onSyncState);
      socket.on("room_not_found", () => {
        window.sessionStorage.removeItem(`watchsync-room-${roomId}`);
        router.replace(`/?room=${encodeURIComponent(roomId)}`);
      });
      socket.on("user_joined", onParticipants);
      socket.on("user_left", onParticipants);
      socket.on("new_message", onMessage);
      socket.on("role_assigned", onRoleAssigned);
      socket.on("video_updated", onVideoUpdated);
      socket.on("playback_updated", onPlaybackUpdated);
      socket.on("queue_updated", onQueueUpdated);
      socket.on("room_reaction", onReaction);
      socket.on("participant_removed", onRemoved);
      socket.on("room_ended", onEnded);
      socket.on("room_error", onRoomError);
      socket.on("error", onRoomError);
      socket.connect();

      return () => {
        cancelled = true;
        socket.emit("leave_room");
        socket.disconnect();
        if (socketRef.current === socket) socketRef.current = null;
      };
    } catch {
      setConnectionState("offline");
      router.replace(`/?room=${encodeURIComponent(roomId)}`);
      return () => { cancelled = true; socket?.disconnect(); };
    }
  }, [roomId, router, identity]);

  const submitJoinPrompt = (event) => {
    event.preventDefault();
    const name = joinName.trim().slice(0, 32);
    if (!name) {
      setJoinPromptError("Enter your display name to join this room.");
      return;
    }
    const roomIdentity = {
      roomId,
      name,
      mode: "join",
      sessionId: window.crypto.randomUUID(),
    };
    window.sessionStorage.setItem(`watchsync-room-${roomId}`, JSON.stringify(roomIdentity));
    setJoinPromptError("");
    setIdentity(roomIdentity);
    setShowJoinPrompt(false);
  };

  useEffect(() => {
    if (!identity || !videoId || !youtubeMountRef.current) return;
    let disposed = false;
    loadYouTubeIframeApi().then((YT) => {
      if (disposed || !youtubeMountRef.current) return;
      if (youtubePlayerRef.current) return;
      youtubePlayerRef.current = new YT.Player(youtubeMountRef.current, {
        width: "100%",
        height: "100%",
        videoId: videoId || undefined,
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, enablejsapi: 1 },
        events: {
          onReady: (event) => {
            const roomState = initialRoomStateRef.current;
            event.target.setVolume(volumeRef.current);
            if (roomState?.videoId) event.target.seekTo(Number(roomState.currentTime) || 0, true);
            if (roomState?.playState === "playing") event.target.playVideo();
            setDuration(event.target.getDuration() || 0);
          },
          onStateChange: (event) => {
            const playerState = YT.PlayerState;
            if (event.data === playerState.PLAYING) setIsPlaying(true);
            if (event.data === playerState.PAUSED || event.data === playerState.ENDED) setIsPlaying(false);
            setDuration(event.target.getDuration() || 0);
            if (event.data === playerState.ENDED && userRoleRef.current === "HOST" && queueListRef.current[0]) {
              socketRef.current?.emit("queue_play", { itemId: queueListRef.current[0].id });
            }
          },
          onError: () => {
            if (initialRoomStateRef.current?.videoId) toastCallbackRef.current?.("This YouTube video cannot be played here.");
          },
        },
      });
    }).catch((error) => toastCallbackRef.current?.(error.message));
    return () => { disposed = true; };
  }, [identity, videoId]);

  useEffect(() => {
    const player = youtubePlayerRef.current;
    if (!player) return;
    player.setVolume(volume);
    if (isMuted) player.mute();
    else player.unMute();
  }, [volume, isMuted]);

  useEffect(() => {
    const player = youtubePlayerRef.current;
    if (!player || !videoId) return;
    const roomState = initialRoomStateRef.current || {};
    player.loadVideoById({ videoId, startSeconds: Number(roomState.currentTime) || 0 });
    if (roomState.playState !== "playing") player.pauseVideo();
  }, [videoId]);

  useEffect(() => {
    if (!isPlaying || !youtubePlayerRef.current) return;
    const timer = window.setInterval(() => {
      const player = youtubePlayerRef.current;
      if (player?.getCurrentTime) {
        setCurrentTime(Math.floor(player.getCurrentTime()));
        setDuration(player.getDuration() || 0);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, videoId]);

  useEffect(() => () => {
    youtubePlayerRef.current?.destroy?.();
    youtubePlayerRef.current = null;
  }, []);

  useEffect(() => {
    if (currentTab === "chat") {
      chatAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, currentTab]);

  useEffect(() => {
    const handleModalKeyDown = (event) => {
      if (event.key === "Escape" && showVideoModal) {
        setShowVideoModal(false);
      }
    };

    window.addEventListener("keydown", handleModalKeyDown);
    return () => window.removeEventListener("keydown", handleModalKeyDown);
  }, [showVideoModal]);

  const applyVolumeLevel = (newVol, notify = false) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newVol)));
    setVolume(clamped);
    const mutedState = clamped === 0;
    setIsMuted(mutedState);
    youtubePlayerRef.current?.setVolume(clamped);
    if (mutedState) youtubePlayerRef.current?.mute();
    else youtubePlayerRef.current?.unMute();
    if (notify) {
      showToastMsg(mutedState ? "Muted" : `Volume ${clamped}%`);
    }
  };

  const triggerReaction = (emoji) => {
    if (!socketRef.current?.connected) return showToastMsg("Reconnect to send a reaction.");
    socketRef.current.emit("send_reaction", { emoji });
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT") return;
      const keyMap = { "1": "🔥", "2": "❤️", "3": "👏", "4": "😂", "5": "⚡", "6": "😮" };
      if (keyMap[e.key]) {
        triggerReaction(keyMap[e.key]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      showToastMsg("Link copied to clipboard!");
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      showToastMsg("Unable to copy the link. Copy it from the address bar.");
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    if (!socketRef.current?.connected) return showToastMsg("Reconnect before sending a message.");
    socketRef.current.emit("send_message", { text });
    setChatInput("");
  };

  const handleLoadVideo = (e) => {
    e.preventDefault();
    const nextVideoId = extractYouTubeVideoId(videoUrl);
    if (!nextVideoId) {
      showToastMsg("Enter a valid YouTube video link.");
      return;
    }
    if (!socketRef.current?.connected) return showToastMsg("Reconnect before changing the video.");
    if (videoModalMode === "queue") {
      socketRef.current.emit("queue_add", { videoId: nextVideoId });
      showToastMsg("Added to the room queue.");
    } else {
      socketRef.current.emit("set_video", { videoId: nextVideoId });
      showToastMsg("Changing the shared video…");
    }
    setShowVideoModal(false);
    setVideoUrl("");
  };

  const openVideoModal = (mode = "replace") => {
    setVideoModalMode(mode);
    setVideoUrl("");
    setShowVideoModal(true);
  };

  const formatTime = (s) => {
    const totalSeconds = Math.max(0, Math.floor(Number(s) || 0));
    const mins = Math.floor(totalSeconds / 60);
    const secs = String(totalSeconds % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const seekBy = (amount) => {
    if (!canStartVideo) return showToastMsg("Only the host or a moderator can control playback.");
    if (!socketRef.current?.connected) return showToastMsg("Reconnect before seeking the video.");
    const nextTime = Math.max(0, Math.min(duration || 86400, (youtubePlayerRef.current?.getCurrentTime?.() ?? currentTime) + amount));
    setCurrentTime(nextTime);
    initialRoomStateRef.current = { ...(initialRoomStateRef.current || {}), currentTime: nextTime };
    youtubePlayerRef.current?.seekTo(nextTime, true);
    socketRef.current?.emit("playback_action", { action: "seek", currentTime: nextTime });
  };

  const togglePlayback = () => {
    if (!canStartVideo) return showToastMsg("Only the host or a moderator can control playback.");
    if (!videoId) return showToastMsg("Add a video before starting playback.");
    if (!socketRef.current?.connected) return showToastMsg("Reconnect before controlling playback.");
    const player = youtubePlayerRef.current;
    const nextTime = player?.getCurrentTime?.() ?? currentTime;
    const action = isPlaying ? "pause" : "play";
    setIsPlaying(action === "play");
    initialRoomStateRef.current = { ...(initialRoomStateRef.current || {}), currentTime: nextTime, playState: action === "play" ? "playing" : "paused" };
    socketRef.current?.emit("playback_action", { action, currentTime: nextTime });
    if (action === "play") player?.playVideo();
    else player?.pauseVideo();
  };

  const seekTo = (time) => {
    if (!socketRef.current?.connected) return showToastMsg("Reconnect before seeking the video.");
    const nextTime = Math.max(0, Math.min(duration || 86400, Number(time) || 0));
    setCurrentTime(nextTime);
    initialRoomStateRef.current = { ...(initialRoomStateRef.current || {}), currentTime: nextTime };
    youtubePlayerRef.current?.seekTo(nextTime, true);
    socketRef.current?.emit("playback_action", { action: "seek", currentTime: nextTime });
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await videoStageRef.current?.requestFullscreen();
      }
    } catch {
      showToastMsg("Fullscreen is unavailable");
    }
  };

  const updateMemberRole = (userId, role) => {
    if (!socketRef.current?.connected) return showToastMsg("Reconnect before changing room roles.");
    socketRef.current?.emit("assign_role", { userId, role: role === "MODERATOR" ? "MODERATOR" : "PARTICIPANT" });
  };

  const removeMember = (userId) => {
    if (!socketRef.current?.connected) return showToastMsg("Reconnect before removing a member.");
    socketRef.current?.emit("remove_participant", { userId });
  };

  return (
    <div className={`watch-room-page ${!isDark ? "theme-light" : "theme-dark"} min-h-screen flex flex-col font-sans transition-colors duration-200 antialiased selection:bg-[#FF0000] selection:text-white ${isDark ? "bg-[#0F0F0F] text-[#F1F1F1]" : "bg-[#F8F8F9] text-[#0F0F0F]"
      }`}>
      {showJoinPrompt && (
        <div className={`room-video-modal-backdrop ${isDark ? "room-video-modal-dark" : "room-video-modal-light"}`}>
          <section className="room-video-modal" role="dialog" aria-modal="true" aria-labelledby="join-room-title">
            <div className="room-video-modal-edge" />
            <header>
              <div>
                <p>ROOM ACCESS</p>
                <h2 id="join-room-title">Join room {roomId}</h2>
              </div>
            </header>
            <p className="room-video-modal-message">Choose a display name to join the shared watch room.</p>
            <form onSubmit={submitJoinPrompt}>
              <label htmlFor="join-room-name">Your display name</label>
              <input
                id="join-room-name"
                value={joinName}
                onChange={(event) => { setJoinName(event.target.value); setJoinPromptError(""); }}
                placeholder="e.g. Alex"
                maxLength={32}
                autoComplete="nickname"
                autoFocus
              />
              {joinPromptError && <p className="room-video-modal-message" role="alert">{joinPromptError}</p>}
              <div className="room-video-modal-actions room-join-prompt-actions">
                <button type="submit" className="room-video-modal-submit">
                  Join room
                  <svg className="room-video-modal-submit-arrow" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      <style>{`
        @keyframes igReactionFloat {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.65) rotate(0deg);
          }
          15% {
            opacity: 0.85;
            transform: translateY(-8px) scale(1.05) rotate(-3deg);
          }
          65% {
            opacity: 0.6;
            transform: translateY(-52px) scale(0.95) rotate(3deg);
          }
          100% {
            opacity: 0;
            transform: translateY(-95px) scale(0.7) rotate(-1deg);
          }
        }
        .ig-reaction-bubble {
          animation: igReactionFloat 1.6s cubic-bezier(0.2, 0.8, 0.25, 1) forwards;
          will-change: transform, opacity;
        }
      `}</style>
      {/* Top Navigation Header */}
      <header className={`room-header h-16 px-4 md:px-7 border-b flex items-center justify-between sticky top-0 z-40 backdrop-blur-xl transition-colors ${isDark ? "bg-[#0F0F0F]/90 border-[#272727]" : "bg-white/95 border-[#E5E5E5]"
        }`}>
        {/* Left: Brand + Room Code Badge */}
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-2 select-none cursor-pointer">
            <span className="w-3.5 h-3.5 bg-[#FF0000] rounded-sm shrink-0 shadow-[0_0_8px_rgba(255,0,0,0.5)]"></span>
            <div className="flex items-baseline text-lg font-black tracking-tight">
              <span className={isDark ? "text-white" : "text-[#0F0F0F]"}>watch</span>
              <span className="text-[#FF3B30] ml-0.5">sync</span>
            </div>
          </div>

          {/* Room Pill */}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(roomId)?.then(() => showToastMsg("Room code copied!"));
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border cursor-pointer transition select-none ${isDark ? "bg-[#181818] border-[#272727] hover:border-neutral-600" : "bg-[#F2F2F2] border-[#E5E5E5] hover:border-neutral-400"
              }`}
            title="Click to copy Room Code"
            aria-label={`Copy room code ${roomId}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF0000] animate-pulse"></span>
            <span className="text-neutral-500 text-[11px] font-medium uppercase tracking-wider">Room</span>
            <span className="font-mono text-[11px] font-semibold">{roomId}</span>
          </button>

          {/* Synchronized playback feature */}
          <div className={`hidden lg:flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium ${isDark ? "bg-[#181818] border-[#272727] text-neutral-300" : "bg-[#F2F2F2] border-[#E5E5E5] text-neutral-700"
            }`}>
            <span className={`w-2 h-2 rounded-full ${connectionState === "connected" ? "bg-emerald-500" : "bg-amber-500"}`}></span>
            <span>{connectionState === "connected" ? "Playback stays in sync" : connectionState === "reconnecting" ? "Reconnecting…" : "Connecting…"}</span>
          </div>
        </div>

        {/* Right: Header Actions */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Dark / Light Theme Toggle */}
          <button
            onClick={() => {
              setIsDark(!isDark);
              showToastMsg(!isDark ? "Dark mode activated" : "Light mode activated");
            }}
            className="room-header-icon-button"
            title="Toggle theme"
          >
            {isDark ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 3a9 9 0 000 18V3z" fill="currentColor" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>

          {/* Copy Link Button */}
          <button
            onClick={handleCopyLink}
            aria-label={copiedLink ? "Link copied" : "Copy room link"}
            title={copiedLink ? "Link copied" : "Copy room link"}
            className={`room-header-copy-button${copiedLink ? " is-copied" : ""}`}
          >
            {copiedLink ? (
              <span className="room-copy-icon">
                <svg style={{ color: "#10b981", flex: "0 0 18px", width: 18, height: 18, display: "block" }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            ) : (
              <span className="room-copy-icon">
                <svg style={{ color: "#f04438", flex: "0 0 18px", width: 18, height: 18, display: "block" }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </span>
            )}
            <span>{copiedLink ? "Copied!" : "Copy Link"}</span>
          </button>

          {/* End Room Button */}
          {currentUserRole === "HOST" ? (
            <button type="button" onClick={() => setShowEndModal(true)} className="room-header-end-button">End Room</button>
          ) : (
            <button type="button" onClick={() => {
              window.sessionStorage.removeItem(`watchsync-room-${roomId}`);
              socketRef.current?.emit("leave_room");
              socketRef.current?.disconnect();
              router.replace("/");
            }} className="room-header-end-button">Leave Room</button>
          )}
        </div>
      </header>

      {/* Main Workspace Theater */}
      <main className="room-workspace flex-1 w-full max-w-[1720px] mx-auto p-3 sm:p-5 md:p-6 lg:p-7 flex flex-col justify-start">
        {/* Equal-Height Synchronized Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_410px] gap-4 items-stretch">

          {/* Left Column: Video Stage + Controls Bar */}
          <section className="flex flex-col gap-3 min-w-0">
            {/* Video Canvas Row + Dedicated Instant Reaction Rail */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch">

              {/* Video Player Frame */}
              <div ref={videoStageRef} className={`room-video-stage relative flex-1 aspect-video rounded-2xl md:rounded-3xl overflow-hidden border shadow-2xl flex items-center justify-center group select-none ${isDark ? "bg-black border-[#272727] shadow-black/80" : "bg-black border-[#E5E5E5] shadow-neutral-400/20"
                }`}>
                {/* Embedded YouTube Player */}
                <div ref={youtubeMountRef} className="h-full w-full" aria-label="Shared YouTube video player" />

                {!hasHostStartedVideo && (
                  <div className="room-video-waiting-overlay" aria-live="polite">
                    <div className="room-video-waiting-spotlight" />
                    <div className="room-video-waiting-card">
                      <span className="room-video-waiting-status">
                        <span className="room-video-waiting-status-dot" />
                        Room Ready
                      </span>
                      <div className="room-video-waiting-brand" aria-label="YouTube">
                        <svg viewBox="0 0 48 34" aria-hidden="true">
                          <path d="M47.1 5.3c-.6-2.1-2.2-3.8-4.3-4.3C38.9 0 24 0 24 0S9.1 0 5.3 1C3.2 1.5 1.6 3.2 1 5.3 0 9.1 0 17 0 17s0 7.9 1 11.7c.6 2.1 2.2 3.8 4.3 4.3 3.8 1 18.7 1 18.7 1s14.9 0 18.7-1c2.1-.6 3.8-2.2 4.3-4.3 1-3.8 1-11.7 1-11.7s0-7.9-1-11.7z" />
                          <path d="M19.2 24.3V9.7l12.8 7.3-12.8 7.3z" fill="#fff" />
                        </svg>
                      </div>
                      <h2 className="room-video-waiting-title">Start the <br />watch party</h2>
                      <p className="room-video-waiting-copy">
                        No borders. No limits. Choose a video and experience seamless synchronization.
                      </p>
                      {canStartVideo && (
                        <button type="button" className="room-video-start-button" onClick={openVideoModal} aria-label="Add a video">
                          <span>Add a video</span>
                          <svg className="room-video-start-arrow" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none">
                            <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Top-Left Host Control Badge */}
                {hasHostStartedVideo && <div className={`absolute top-3.5 left-3.5 z-20 pointer-events-none flex items-center gap-2 backdrop-blur-md border px-3 py-1.5 rounded-full text-[11px] font-medium shadow-lg ${isDark ? "bg-[#0F0F0F]/80 border-[#272727] text-neutral-200" : "bg-white/90 border-[#E5E5E5] text-neutral-800"
                  }`}>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>You have host control</span>
                </div>}

                {/* Floating reactions remain emoji-based; the trigger below uses a regular icon. */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                  {reactions.map((r) => (
                    <div
                      key={r.id}
                      className="ig-reaction-bubble absolute pointer-events-none select-none text-2xl filter drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
                      style={{
                        bottom: "18px",
                        right: `${r.offsetRight || 24}px`,
                      }}
                    >
                      {r.emoji}
                    </div>
                  ))}
                </div>

                {/* Vertical reaction picker */}
                <div className="reaction-launcher absolute bottom-4 right-4 z-30 flex flex-col items-end">
                  <div
                    className={`reaction-picker ${showReactionPicker ? "is-open" : "is-closed"} flex flex-col items-center gap-0.5 rounded-xl border p-1 shadow-2xl backdrop-blur-xl ${isDark
                      ? "border-white/15 bg-[#12141a]/95"
                      : "border-black/10 bg-white/95"
                      }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {[
                      { emoji: "🔥", name: "Fire (1)" },
                      { emoji: "❤️", name: "Love (2)" },
                      { emoji: "👏", name: "Clap (3)" },
                      { emoji: "😂", name: "Haha (4)" },
                      { emoji: "⚡", name: "Hype (5)" },
                      { emoji: "😮", name: "Woah (6)" },
                    ].map((item) => (
                      <button
                        key={item.emoji}
                        type="button"
                        onClick={() => {
                          triggerReaction(item.emoji);
                          setShowReactionPicker(false);
                        }}
                        className="reaction-option flex h-7 w-7 items-center justify-center rounded-lg text-base transition-transform hover:scale-110 active:scale-90"
                        style={{ "--reaction-delay": `${item.emoji === "🔥" ? 0 : ["❤️", "👏", "😂", "⚡", "😮"].indexOf(item.emoji) + 1}0ms` }}
                        title={item.name}
                        aria-label={item.name}
                      >
                        {item.emoji}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowReactionPicker((open) => !open);
                    }}
                    className="reaction-trigger flex h-8 w-8 items-center justify-center transition-all hover:scale-110 active:scale-95"
                    title="Send a reaction"
                    aria-label="Send a reaction"
                    aria-expanded={showReactionPicker}
                  >
                    <svg aria-hidden="true" className="reaction-trigger-icon h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75l1.34 4.91a2 2 0 001.41 1.41L19.66 11.4l-4.91 1.34a2 2 0 00-1.41 1.41L12 19.06l-1.34-4.91a2 2 0 00-1.41-1.41L4.34 12.74l4.91-1.34a2 2 0 001.41-1.41L12 3.75z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.25 4.5v2.25m1.125-1.125h-2.25M5.5 17.25v1.5m.75-.75H4.75" />
                    </svg>
                  </button>
                </div>
              </div>

            </div>

            {/* Playback Controls Bar */}
            <div className={`playback-controls w-full border p-2 sm:py-1.5 sm:px-2.5 rounded-2xl flex flex-col sm:flex-row items-center gap-2 sm:gap-3 shadow-lg transition-colors ${isDark ? "bg-[#181818] border-[#272727]" : "bg-white border-[#E5E5E5]"
              }`}>
              {/* Timecode & Scrubber with #FF0000 Accent */}
              <div className="flex-1 w-full flex items-center gap-3">
                <div className="relative w-full flex items-center">
                  <div className={`absolute left-0 right-0 h-1.5 rounded-full pointer-events-none overflow-hidden ${isDark ? "bg-[#272727]" : "bg-[#E5E5E5]"
                    }`}>
                    <div
                      className="h-full bg-[#FF0000] transition-all"
                      style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(duration, 1)}
                    value={currentTime}
                    onChange={(e) => setCurrentTime(Number(e.target.value))}
                    onPointerUp={(e) => seekTo(e.currentTarget.value)}
                    onKeyUp={(e) => seekTo(e.currentTarget.value)}
                    disabled={!videoId || !canStartVideo}
                    className="seek-slider relative z-10 w-full h-1.5 bg-transparent appearance-none cursor-pointer focus:outline-none accent-[#FF0000]"
                  />
                </div>

                <span className="text-[11px] font-mono opacity-70 shrink-0 font-medium tracking-tight">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Playback utility buttons */}
              <div className="playback-actions flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={togglePlayback}
                  disabled={!videoId || !canStartVideo}
                  className="playback-icon"
                  title={isPlaying ? "Pause" : "Play"}
                  aria-label={isPlaying ? "Pause playback" : "Resume playback"}
                >
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M7.5 5.5h3.25v13H7.5zm5.75 0h3.25v13h-3.25z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5.25v13.5L19 12 8 5.25z" />
                    </svg>
                  )}
                </button>

                <div className="skip-controls flex items-center gap-0">
                  <button
                    type="button"
                    onClick={() => seekBy(-10)}
                    disabled={!videoId || !canStartVideo}
                    className="playback-icon skip-button"
                    title="Skip back 10 seconds"
                    aria-label="Skip back 10 seconds"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M6.2 6.2H3.4V3.4M6.2 6.2A8 8 0 1 1 4 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <text x="12" y="14.8" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="6.2" fontWeight="600" textAnchor="middle">10</text>
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => seekBy(10)}
                    disabled={!videoId || !canStartVideo}
                    className="playback-icon skip-button"
                    title="Skip forward 10 seconds"
                    aria-label="Skip forward 10 seconds"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M17.8 6.2h2.8V3.4M17.8 6.2A8 8 0 1 0 20 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <text x="12" y="14.8" fill="currentColor" fontFamily="Arial, sans-serif" fontSize="6.2" fontWeight="600" textAnchor="middle">10</text>
                    </svg>
                  </button>
                </div>

                {/* Familiar, inline player volume control */}
                <div className={`volume-control relative flex items-center${showVolumeSlider ? " volume-slider-open" : ""}`}>
                  {/* Speaker Button with Auto-Mute Icon Detection */}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.matchMedia("(hover: none)").matches) {
                        setShowVolumeSlider((open) => !open);
                        return;
                      }
                      if (isMuted) {
                        setIsMuted(false);
                        applyVolumeLevel(volume === 0 ? 80 : volume, true);
                      } else {
                        setIsMuted(true);
                        showToastMsg("Muted");
                      }
                    }}
                    aria-label={isMuted ? "Unmute" : "Mute"}
                    aria-expanded={showVolumeSlider}
                    className="playback-icon volume-toggle"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted || volume === 0 ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                    ) : volume < 50 ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                    )}
                  </button>
                  <div className="volume-slider-popover" aria-hidden={!showVolumeSlider}>
                    <span className="volume-level-readout">{isMuted ? 0 : volume}%</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={isMuted ? 0 : volume}
                      onChange={(event) => applyVolumeLevel(Number(event.target.value))}
                      aria-label="Volume"
                      aria-valuetext={`${isMuted ? 0 : volume}%`}
                      tabIndex={showVolumeSlider ? 0 : -1}
                      className="volume-inline-slider"
                      style={{ "--volume-level": `${isMuted ? 0 : volume}%` }}
                    />
                  </div>
                </div>

                {/* Fullscreen Button */}
                <button
                  onClick={toggleFullscreen}
                  className={`playback-icon ${isDark
                    ? "bg-[#272727] hover:bg-[#333333] border-[#333333] text-[#F1F1F1]"
                    : "bg-[#F2F2F2] hover:bg-[#E5E5E5] border-[#E5E5E5] text-[#0F0F0F]"
                    }`}
                  title="Toggle fullscreen"
                  aria-label="Toggle fullscreen"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 3H5a2 2 0 00-2 2v3m13-5h3a2 2 0 012 2v3m0 8v3a2 2 0 01-2 2h-3M8 21H5a2 2 0 01-2-2v-3" />
                  </svg>
                </button>

                {/* Change Video Action Pill */}
                {canStartVideo && <button
                  type="button"
                  onClick={openVideoModal}
                  className="change-video-trigger"
                  title="Change the synchronized video"
                >
                  <span className="change-video-trigger-icon">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </span>
                  <span>Change video</span>
                </button>}
              </div>
            </div>
          </section>

          {/* Right Column: Sidebar locked to match video column height */}
          <aside className={`room-sidebar w-full rounded-2xl md:rounded-3xl border flex flex-col h-full min-h-[460px] overflow-hidden transition-colors shadow-lg ${isDark ? "bg-[#141414] border-[#272727]" : "bg-white border-[#E5E5E5]"
            }`}>
            {/* Sidebar navigation */}
            <div className="room-sidebar-tabs-shell border-b border-inherit shrink-0">
              <div ref={roomTabsRef} className={`room-sidebar-tabs${isDark ? "" : " is-light"}`}>
                <div
                  className="room-sidebar-tab-indicator"
                  style={tabCapsuleStyle}
                />

                <button
                  type="button"
                  onClick={() => setCurrentTab("chat")}
                  className={`room-sidebar-tab${currentTab === "chat" ? " is-active" : ""}`}
                >
                  <span ref={(node) => { roomTabContentRefs.current.chat = node; }} className="room-sidebar-tab-content">Live Chat</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentTab("audience")}
                  className={`room-sidebar-tab${currentTab === "audience" ? " is-active" : ""}`}
                >
                  <span ref={(node) => { roomTabContentRefs.current.audience = node; }} className="room-sidebar-tab-content">
                    <span>Audience</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentTab("queue")}
                  className={`room-sidebar-tab${currentTab === "queue" ? " is-active" : ""}`}
                >
                  <span ref={(node) => { roomTabContentRefs.current.queue = node; }} className="room-sidebar-tab-content">
                    <span>Queue</span>
                  </span>
                </button>
              </div>
            </div>

            {/* Pane 1: Live Chat Pane (Input strictly encapsulated here) */}
            {currentTab === "chat" && (
              <div className="room-sidebar-pane flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="room-sidebar-scroll flex-1 overflow-y-auto p-3.5 space-y-3">
                  {chatMessages.length === 0 && <p className="py-6 text-center text-xs opacity-50">No messages yet. Say hello to the room.</p>}
                  {chatMessages.map((msg) => {
                    const isOwnMessage = !msg.isSystem && Boolean(socketRef.current?.id) && msg.id?.startsWith(`${socketRef.current.id}-`);
                    return (
                    <div key={msg.id} className="flex flex-col text-sm">
                      <div className="flex w-full items-center gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`truncate text-[11px] font-semibold ${msg.isSystem ? "opacity-40" : ""}`}>
                            {msg.name}
                          </span>
                          {msg.role && msg.role !== "PARTICIPANT" && (
                            <span className={`shrink-0 text-[9px] px-1.5 py-0.2 rounded-md font-mono font-medium ${isDark ? "bg-[#272727] text-neutral-300" : "bg-[#E5E5E5] text-neutral-700"
                              }`}>
                              {msg.role === "MODERATOR" ? "MOD" : msg.role}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-0.5 flex w-full items-end gap-2">
                        <p className={`border rounded-2xl px-3.5 py-2 self-start break-words max-w-[90%] shadow-sm text-xs ${msg.isSystem
                          ? isDark
                            ? "bg-[#181818] border-[#272727] text-neutral-400"
                            : "bg-[#F2F2F2] border-[#E5E5E5] text-neutral-600"
                          : isOwnMessage
                            ? isDark
                              ? "bg-[#211817] border-[#3B2926] text-[#F3E7E5]"
                              : "bg-[#FFF1EF] border-[#F1D2CD] text-[#34211F]"
                            : isDark
                              ? "bg-[#181818] border-[#272727] text-neutral-200"
                              : "bg-[#F2F2F2] border-[#E5E5E5] text-neutral-800"
                          }`}>
                          {msg.text}
                        </p>
                        {msg.sentAt && <span className="mb-1 ml-auto shrink-0 text-right text-[10px] opacity-40">{new Date(msg.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
                      </div>
                    </div>
                    );
                  })}
                  <div ref={chatAnchorRef} />
                </div>

                {/* Chat Form: Lives ONLY in chat pane */}
                <form
                  onSubmit={handleSendMessage}
                  className={`room-sidebar-footer p-3 border-t shrink-0 ${isDark ? "bg-[#111111] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                    }`}
                >
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Send message to room..."
                      maxLength={250}
                      className={`w-full border rounded-xl pl-3.5 pr-11 py-2.5 text-xs focus:outline-none focus:border-[#FF0000] transition ${isDark
                        ? "bg-[#181818] border-[#272727] text-white placeholder-neutral-500"
                        : "bg-white border-[#E5E5E5] text-[#0F0F0F] placeholder-neutral-400"
                        }`}
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      className={`absolute right-2 p-1.5 rounded-lg transition active:scale-95 shadow-sm disabled:opacity-40 ${isDark ? "bg-[#F1F1F1] hover:bg-white text-[#0F0F0F]" : "bg-[#0F0F0F] hover:bg-black text-white"
                        }`}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Pane 2: Audience Pane (Fills vertical height cleanly, NO chat input) */}
            {currentTab === "audience" && (
              <div className="room-sidebar-pane audience-pane flex-1 flex flex-col justify-between p-4 overflow-hidden min-h-0 space-y-4">
                <div className="room-sidebar-scroll space-y-2.5 overflow-y-auto min-h-0">
                  <div className="flex items-center justify-between pb-1.5 border-b border-inherit">
                    <span className="text-xs font-bold">Room Members</span>
                    <span className="text-[11px] opacity-50 font-mono">{participants.length} Active</span>
                  </div>
                  {participants.map((participant) => {
                    const isSelf = participant.userId === socketRef.current?.id;
                    const isHost = participant.role === "HOST";
                    const roleLabel = participant.role === "PARTICIPANT" ? "VIEWER" : participant.role;
                    return (
                      <div key={participant.userId} className={`audience-member-card flex items-center justify-between rounded-2xl border ${isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`audience-avatar relative rounded-lg border flex items-center justify-center font-bold text-xs ${isDark ? "bg-[#272727] border-[#383838] text-white" : "bg-neutral-200 border-neutral-300 text-black"}`}>
                            {(participant.username || "?").charAt(0).toUpperCase()}
                            <span className="audience-online-dot absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{isSelf ? "You" : participant.username}</p>
                            <span className="text-[10px] opacity-60 font-mono">{roleLabel}</span>
                          </div>
                        </div>
                        {isHost ? (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border ${isDark ? "bg-[#272727] border-[#383838] text-neutral-300" : "bg-[#E5E5E5] border-[#D5D5D5] text-neutral-800"}`}>HOST</span>
                        ) : currentUserRole === "HOST" && !isSelf ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button type="button" onClick={() => updateMemberRole(participant.userId, participant.role === "MODERATOR" ? "PARTICIPANT" : "MODERATOR")} className={`px-2.5 py-1 text-[11px] rounded-lg transition font-medium ${isDark ? "bg-[#272727] hover:bg-[#333] text-neutral-300" : "bg-[#E5E5E5] hover:bg-[#D5D5D5] text-neutral-700"}`}>
                              {participant.role === "MODERATOR" ? "Demote" : "Mod"}
                            </button>
                            <button type="button" onClick={() => removeMember(participant.userId)} className="px-2.5 py-1 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 text-[11px] rounded-lg transition font-medium">Kick</button>
                          </div>
                        ) : (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${isDark ? "bg-[#272727] text-neutral-400" : "bg-[#E5E5E5] text-neutral-700"}`}>{roleLabel}</span>
                        )}
                      </div>
                    );
                  })}
                  {participants.length === 0 && <p className="py-6 text-center text-xs opacity-50">Waiting for room members…</p>}
                </div>                {/* Bottom: Compact host permissions */}
                <div className={`room-sidebar-footer room-permissions-footer${isDark ? "" : " is-light"}`}>
                  <span className="room-permissions-title"><i /><span className="room-permissions-host">Host</span><span>Permissions</span></span>
                  <p>Playback, video changes, and queue controls are available to hosts and moderators.</p>
                </div>
              </div>
            )}

            {/* Pane 3: Queue Pane (Fills vertical height cleanly, NO chat input) */}
            {currentTab === "queue" && (
              <div className="room-sidebar-pane flex-1 flex flex-col justify-between p-4 overflow-hidden min-h-0 space-y-4">
                <div className="room-sidebar-scroll space-y-3 overflow-y-auto min-h-0">
                  <div className={`p-3.5 rounded-2xl border space-y-2 ${isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                    }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold font-mono tracking-wider opacity-60 uppercase flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        {videoId ? "Now Playing" : "Nothing Playing"}
                      </span>
                      <span className="text-[11px] font-mono opacity-60 font-medium">{isPlaying ? "PLAYING" : "PAUSED"}</span>
                    </div>
                    <div>
                      <p className="text-xs font-bold leading-snug">{videoId ? `YouTube video ${videoId}` : "Add a video to start watching"}</p>
                      <p className="text-[11px] opacity-60 mt-0.5">{videoId ? "Shared with everyone in this room" : "The room is ready"}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pb-1 border-b border-inherit">
                    <span className="text-xs font-bold">Up Next</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-4 h-4 rounded-full text-[10px] font-mono font-medium flex items-center justify-center leading-none ${isDark ? "bg-[#272727] text-white" : "bg-[#E5E5E5] text-black"
                        }`}>
                        {queueList.length}
                      </span>
                      <span className="text-[11px] opacity-60 font-medium">{queueList.length === 1 ? "video queued" : "videos queued"}</span>
                    </div>
                  </div>

                  {queueList.length === 0 && <p className="py-5 text-center text-xs opacity-50">The queue is empty. Add a YouTube link to get started.</p>}
                  {queueList.map((track) => (
                    <div
                      key={track.id}
                      className={`p-3 rounded-2xl border flex items-center justify-between ${isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                        }`}
                    >
                      <div className="space-y-0.5">
                        <p className="text-xs font-semibold">{track.title}</p>
                        <span className="text-[10px] opacity-60">Requested by {track.requestedBy}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {canStartVideo && <button type="button" onClick={() => socketRef.current?.emit("queue_play", { itemId: track.id })} className="rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-500">Play</button>}
                        {(canStartVideo || track.requestedById === socketRef.current?.id) && <button type="button" onClick={() => socketRef.current?.emit("queue_remove", { itemId: track.id })} className="rounded-md px-2 py-1 text-[10px] opacity-60 hover:opacity-100">Remove</button>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="room-sidebar-footer pt-3 border-t border-inherit space-y-2 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Queue Next Video</span>
                    <span className="text-[10px] opacity-60 font-medium">Autoplay On</span>
                  </div>
                  <button
                    onClick={() => openVideoModal("queue")}
                    className={`w-full py-2.5 px-3.5 rounded-xl border text-xs font-semibold transition flex items-center justify-center gap-2 shadow-sm ${isDark
                      ? "bg-[#181818] hover:bg-[#222222] border-[#272727] text-white"
                      : "bg-[#F2F2F2] hover:bg-[#E5E5E5] border-[#E5E5E5] text-black"
                      }`}
                  >
                    <span className="queue-add-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span>Add YouTube Link to Queue</span>
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* Change Video Modal */}
      {showVideoModal && (
        <div
          className={`room-video-modal-backdrop ${isDark ? "room-video-modal-dark" : "room-video-modal-light"}`}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowVideoModal(false);
          }}
        >
          <div
            className="room-video-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-video-title"
          >
            <div className="room-video-modal-edge" />
            <header>
              <div>
                <p>ROOM CONTROL</p>
                <h2 id="change-video-title">{videoModalMode === "queue" ? "Add to queue" : "Change the video"}</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowVideoModal(false)}
                className="room-video-modal-close"
                aria-label="Close change video dialog"
              >
                ×
              </button>
            </header>

            <p className="room-video-modal-message">
              {videoModalMode === "queue" ? "Add a YouTube video for the room to watch next." : "Paste a YouTube link to change the shared video for everyone in the room."}
            </p>

            <form onSubmit={handleLoadVideo}>
              <label htmlFor="room-video-url">YouTube URL</label>
              <input
                id="room-video-url"
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="youtube.com/watch?v=..."
                autoFocus
              />
              <div className="room-video-modal-actions">
                <button
                  type="button"
                  onClick={() => setShowVideoModal(false)}
                  className="room-video-modal-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="room-video-modal-submit"
                >
                  {videoModalMode === "queue" ? "Add to queue" : "Load & sync"} <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* End Room Modal */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`max-w-sm w-full border p-6 rounded-3xl space-y-4 text-center shadow-2xl transition-colors ${isDark ? "bg-[#181818] border-[#272727] text-white" : "bg-white border-[#E5E5E5] text-[#0F0F0F]"
            }`}>
            <div className="w-12 h-12 rounded-2xl bg-[#FF0000]/10 text-[#FF0000] mx-auto flex items-center justify-center text-xl font-bold border border-[#FF0000]/30">
              !
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold">End room for everyone?</h3>
              <p className="text-xs opacity-60">This will disconnect every participant and close the room.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowEndModal(false)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition ${isDark ? "bg-[#272727] hover:bg-[#333] text-[#F1F1F1]" : "bg-[#F2F2F2] hover:bg-[#E5E5E5] text-[#0F0F0F]"
                  }`}
              >
                Stay
              </button>
              <button
                onClick={() => {
                  setShowEndModal(false);
                  if (!socketRef.current?.connected) return showToastMsg("Reconnect before ending the room.");
                  socketRef.current.emit("end_room");
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#FF0000] hover:bg-red-600 text-xs font-bold text-white transition shadow-lg shadow-red-600/30"
              >
                End Room
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0F0F0F] text-white grid place-items-center text-sm">Connecting to room…</main>}>
      <RoomPage />
    </Suspense>
  );
}
