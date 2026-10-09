"use client";

import React, { useState, useEffect, useRef } from "react";

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [currentTime, setCurrentTime] = useState(42);
  const duration = 180;
  const [currentTab, setCurrentTab] = useState("chat");
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [videoUrl, setVideoUrl] = useState("https://www.youtube.com/watch?v=jfKfPfyJRdk");
  const [videoId, setVideoId] = useState("jfKfPfyJRdk");
  const [toast, setToast] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [memberRoles, setMemberRoles] = useState({ maya: "MODERATOR", liam: "VIEWER" });
  const [removedMembers, setRemovedMembers] = useState([]);
  const [chatMessages, setChatMessages] = useState([
    {
      id: 1,
      name: "System",
      text: "Welcome to WatchSync! Playback is locked in exact real-time sync with all peers.",
      isSystem: true,
    },
    {
      id: 2,
      name: "Maya",
      badge: "MOD",
      text: "Sound and 4K quality look crisp 🔥 Everyone ready for the drop?",
      time: "2m ago",
    },
    {
      id: 3,
      name: "Liam",
      text: "Audio sync is zero-delay. Loving this track! 🎶",
      time: "Just now",
    },
  ]);

  const [queueList] = useState([
    { id: 1, title: "Interstellar Live Orchestra", req: "Requested by Liam • 4:12" },
    { id: 2, title: "Lofi Hip Hop Radio 24/7", req: "Requested by Maya • Live" },
    { id: 3, title: "Cyberpunk 2077 Night City Mix", req: "Requested by You • 3:45" },
  ]);

  const chatAnchorRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const videoStageRef = useRef(null);

  const showToastMsg = (msg) => {
    setToast(msg);
    clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(""), 2500);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPlaying) {
        setCurrentTime((prev) => (prev < duration ? prev + 1 : prev));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isPlaying, duration]);

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
    if (notify) {
      showToastMsg(mutedState ? "Muted" : `Volume ${clamped}%`);
    }
  };

  const triggerReaction = (emoji) => {
    const id = Date.now() + Math.random();
    const offsetRight = 14 + Math.floor(Math.random() * 38);
    setReactions((prev) => [...prev, { id, emoji, offsetRight }]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 1700);
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

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopiedLink(true);
    showToastMsg("Link copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setChatMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        name: "You",
        badge: "HOST",
        text: chatInput.trim(),
        time: "Just now",
      },
    ]);
    setChatInput("");
  };

  const handleLoadVideo = (e) => {
    e.preventDefault();
    const match = videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/))([\w-]{11})/i);
    const vId = match ? match[1] : (videoUrl.trim().length === 11 ? videoUrl.trim() : "jfKfPfyJRdk");
    setVideoId(vId);
    setShowVideoModal(false);
    setCurrentTime(0);
    showToastMsg("Video synchronized with room!");
  };

  const openVideoModal = () => setShowVideoModal(true);

  const formatTime = (s) => {
    const mins = Math.floor(s / 60);
    const secs = String(s % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const seekBy = (amount) => {
    const nextTime = Math.max(0, Math.min(duration, currentTime + amount));
    setCurrentTime(nextTime);
    showToastMsg(`${amount > 0 ? "+" : ""}${amount}s`);
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

  const updateMemberRole = (member, role) => {
    setMemberRoles((prev) => ({ ...prev, [member]: role }));
    showToastMsg(`${member === "maya" ? "Maya" : "Liam"} ${role === "MODERATOR" ? "promoted to Moderator" : "demoted"}`);
  };

  const removeMember = (member) => {
    setRemovedMembers((prev) => [...prev, member]);
    showToastMsg(`${member === "maya" ? "Maya" : "Liam"} was removed from the room`);
  };

  return (
    <div className={`watch-room-page ${!isDark ? "theme-light" : "theme-dark"} min-h-screen flex flex-col font-sans transition-colors duration-200 antialiased selection:bg-[#FF0000] selection:text-white ${
      isDark ? "bg-[#0F0F0F] text-[#F1F1F1]" : "bg-[#F8F8F9] text-[#0F0F0F]"
    }`}>
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
      <header className={`room-header h-16 px-4 md:px-7 border-b flex items-center justify-between sticky top-0 z-40 backdrop-blur-xl transition-colors ${
        isDark ? "bg-[#0F0F0F]/90 border-[#272727]" : "bg-white/95 border-[#E5E5E5]"
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
          <div
            onClick={() => {
              navigator.clipboard?.writeText("sync-8842");
              showToastMsg("Room code 'sync-8842' copied!");
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border cursor-pointer transition select-none ${
              isDark ? "bg-[#181818] border-[#272727] hover:border-neutral-600" : "bg-[#F2F2F2] border-[#E5E5E5] hover:border-neutral-400"
            }`}
            title="Click to copy Room Code"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF0000] animate-pulse"></span>
            <span className="text-neutral-500 text-[11px] font-medium uppercase tracking-wider">Room</span>
            <span className="font-mono text-[11px] font-semibold">sync-8842</span>
          </div>

          {/* Synchronized Watchers Badge */}
          <div className={`hidden lg:flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium ${
            isDark ? "bg-[#181818] border-[#272727] text-neutral-300" : "bg-[#F2F2F2] border-[#E5E5E5] text-neutral-700"
          }`}>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>14,290 synchronized watchers</span>
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
            className={`p-2 rounded-xl border transition ${
              isDark ? "bg-[#181818] border-[#272727] text-neutral-300 hover:text-white" : "bg-[#F2F2F2] border-[#E5E5E5] text-neutral-700 hover:text-black"
            }`}
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
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition shadow-sm active:scale-95 ${
              copiedLink
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                : isDark
                ? "bg-[#272727] hover:bg-[#333333] border-[#333333] text-[#F1F1F1]"
                : "bg-[#F2F2F2] hover:bg-[#E5E5E5] border-[#E5E5E5] text-[#0F0F0F]"
            }`}
          >
            {copiedLink ? (
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-[#FF0000]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
            <span>{copiedLink ? "Copied!" : "Copy Link"}</span>
          </button>

          {/* End Room Button */}
          <button
            onClick={() => setShowEndModal(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#FF0000]/10 hover:bg-[#FF0000]/20 text-[#FF0000] border border-[#FF0000]/30 transition active:scale-95"
          >
            End Room
          </button>
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
              <div ref={videoStageRef} className={`room-video-stage relative flex-1 aspect-video rounded-2xl md:rounded-3xl overflow-hidden border shadow-2xl flex items-center justify-center group select-none ${
                isDark ? "bg-black border-[#272727] shadow-black/80" : "bg-black border-[#E5E5E5] shadow-neutral-400/20"
              }`}>
                {/* Embedded YouTube Player */}
                <iframe
                  className="w-full h-full pointer-events-none"
                  src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&controls=0&modestbranding=1&rel=0&playsinline=1&autoplay=1&cc_load_policy=0`}
                  title="WatchSync Theater"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />

                {/* Clickable Overlay with Pure Floating Icon (NO Gray Box) */}
                <div
                  onClick={() => {
                    setIsPlaying(!isPlaying);
                    showToastMsg(!isPlaying ? "Stream Resumed" : "Stream Paused");
                  }}
                  className="absolute inset-0 z-10 cursor-pointer flex items-center justify-center bg-black/10 hover:bg-black/25 transition group/overlay"
                >
                  <div className={`text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)] flex items-center justify-center transition-all duration-200 select-none pointer-events-none ${
                    isPlaying ? "opacity-0 scale-90 group-hover/overlay:opacity-100 group-hover/overlay:scale-100" : "opacity-95 scale-100"
                  }`}>
                    <span className="text-5xl md:text-6xl font-black">
                      {isPlaying ? "❚❚" : "▶"}
                    </span>
                  </div>
                </div>

                {/* Top-Left Host Control Badge */}
                <div className={`absolute top-3.5 left-3.5 z-20 pointer-events-none flex items-center gap-2 backdrop-blur-md border px-3 py-1.5 rounded-full text-[11px] font-medium shadow-lg ${
                  isDark ? "bg-[#0F0F0F]/80 border-[#272727] text-neutral-200" : "bg-white/90 border-[#E5E5E5] text-neutral-800"
                }`}>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>You have host control</span>
                </div>

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
                      className={`reaction-picker ${showReactionPicker ? "is-open" : "is-closed"} flex flex-col items-center gap-0.5 rounded-xl border p-1 shadow-2xl backdrop-blur-xl ${
                        isDark
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
            <div className={`playback-controls w-full border p-2 sm:py-1.5 sm:px-2.5 rounded-2xl flex flex-col sm:flex-row items-center gap-2 sm:gap-3 shadow-lg transition-colors ${
              isDark ? "bg-[#181818] border-[#272727]" : "bg-white border-[#E5E5E5]"
            }`}>
              {/* Timecode & Scrubber with #FF0000 Accent */}
              <div className="flex-1 w-full flex items-center gap-3">
                <div className="relative w-full flex items-center">
                  <div className={`absolute left-0 right-0 h-1.5 rounded-full pointer-events-none overflow-hidden ${
                    isDark ? "bg-[#272727]" : "bg-[#E5E5E5]"
                  }`}>
                    <div
                      className="h-full bg-[#FF0000] transition-all"
                      style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={duration}
                    value={currentTime}
                    onChange={(e) => setCurrentTime(Number(e.target.value))}
                    className="seek-slider relative z-10 w-full h-1.5 bg-transparent appearance-none cursor-pointer focus:outline-none accent-[#FF0000]"
                  />
                </div>

                <span className="text-[11px] font-mono opacity-70 shrink-0 font-medium tracking-tight">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Playback utility buttons */}
              <div className="playback-actions flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                <div className="skip-controls flex items-center gap-0">
                <button
                  type="button"
                  onClick={() => seekBy(-10)}
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

                <button
                  type="button"
                  onClick={() => setIsPlaying((playing) => !playing)}
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
                  className={`playback-icon ${
                    isDark
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
                <button
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
                </button>
              </div>
            </div>
          </section>

          {/* Right Column: Sidebar locked to match video column height */}
          <aside className={`room-sidebar w-full rounded-2xl md:rounded-3xl border flex flex-col h-full min-h-[460px] overflow-hidden transition-colors shadow-lg ${
            isDark ? "bg-[#141414] border-[#272727]" : "bg-white border-[#E5E5E5]"
          }`}>
            {/* 1/3 Segmented Tab Capsule */}
            <div className="p-3 border-b border-inherit shrink-0">
              <div className={`relative flex items-center p-1 border rounded-2xl shadow-inner select-none ${
                isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F2F2F2] border-[#E5E5E5]"
              }`}>
                {/* Fluid Sliding Glider Pill */}
                <div
                  className={`absolute rounded-xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-sm pointer-events-none ${
                    isDark ? "bg-[#272727]" : "bg-white"
                  }`}
                  style={{
                    width: "calc((100% - 8px) / 3)",
                    top: "4px",
                    bottom: "4px",
                    left:
                      currentTab === "chat"
                        ? "4px"
                        : currentTab === "audience"
                        ? "calc(4px + (100% - 8px) / 3)"
                        : "calc(4px + ((100% - 8px) / 3) * 2)",
                  }}
                />

                <button
                  type="button"
                  onClick={() => setCurrentTab("chat")}
                  className={`flex-1 relative z-10 py-2 px-2 text-xs rounded-xl transition-colors duration-200 flex items-center justify-center focus:outline-none ${
                    currentTab === "chat"
                      ? isDark ? "font-semibold text-white" : "font-semibold text-[#0F0F0F]"
                      : isDark ? "font-medium text-neutral-400 hover:text-white" : "font-medium text-neutral-500 hover:text-black"
                  }`}
                >
                  Live Chat
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentTab("audience")}
                  className={`flex-1 relative z-10 py-2 px-2 text-xs rounded-xl transition-colors duration-200 flex items-center justify-center gap-1.5 focus:outline-none ${
                    currentTab === "audience"
                      ? isDark ? "font-semibold text-white" : "font-semibold text-[#0F0F0F]"
                      : isDark ? "font-medium text-neutral-400 hover:text-white" : "font-medium text-neutral-500 hover:text-black"
                  }`}
                >
                  <span>Audience</span>
                  <span className={`w-4 h-4 rounded-full text-[10px] font-mono font-medium flex items-center justify-center leading-none shrink-0 transition-colors ${
                    currentTab === "audience"
                      ? isDark
                        ? "bg-[#181818] text-white"
                        : "bg-[#E5E5E5] text-black"
                      : isDark
                      ? "bg-[#272727] text-neutral-400"
                      : "bg-[#E5E5E5] text-neutral-600"
                  }`}>
                    3
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentTab("queue")}
                  className={`flex-1 relative z-10 py-2 px-2 text-xs rounded-xl transition-colors duration-200 flex items-center justify-center gap-1.5 focus:outline-none ${
                    currentTab === "queue"
                      ? isDark ? "font-semibold text-white" : "font-semibold text-[#0F0F0F]"
                      : isDark ? "font-medium text-neutral-400 hover:text-white" : "font-medium text-neutral-500 hover:text-black"
                  }`}
                >
                  <span>Queue</span>
                  <span className={`w-4 h-4 rounded-full text-[10px] font-mono font-medium flex items-center justify-center leading-none shrink-0 transition-colors ${
                    currentTab === "queue"
                      ? isDark
                        ? "bg-[#181818] text-white"
                        : "bg-[#E5E5E5] text-black"
                      : isDark
                      ? "bg-[#272727] text-neutral-400"
                      : "bg-[#E5E5E5] text-neutral-600"
                  }`}>
                    3
                  </span>
                </button>
              </div>
            </div>

            {/* Pane 1: Live Chat Pane (Input strictly encapsulated here) */}
            {currentTab === "chat" && (
              <div className="room-sidebar-pane flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="room-sidebar-scroll flex-1 overflow-y-auto p-3.5 space-y-3">
                  {chatMessages.map((msg) => (
                    <div key={msg.id} className="flex flex-col text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-semibold ${msg.isSystem ? "opacity-40" : ""}`}>
                          {msg.name}
                        </span>
                        {msg.badge && (
                          <span className={`text-[9px] px-1.5 py-0.2 rounded-md font-mono font-medium ${
                            isDark ? "bg-[#272727] text-neutral-300" : "bg-[#E5E5E5] text-neutral-700"
                          }`}>
                            {msg.badge}
                          </span>
                        )}
                        {msg.time && <span className="text-[10px] opacity-40">{msg.time}</span>}
                      </div>
                      <p className={`border rounded-2xl px-3.5 py-2 mt-0.5 self-start break-words max-w-[90%] shadow-sm text-xs ${
                        msg.isSystem
                          ? isDark
                            ? "bg-[#181818] border-[#272727] text-neutral-400"
                            : "bg-[#F2F2F2] border-[#E5E5E5] text-neutral-600"
                          : isDark
                          ? "bg-[#181818] border-[#272727] text-neutral-200"
                          : "bg-[#F2F2F2] border-[#E5E5E5] text-neutral-800"
                      }`}>
                        {msg.text}
                      </p>
                    </div>
                  ))}
                  <div ref={chatAnchorRef} />
                </div>

                {/* Chat Form: Lives ONLY in chat pane */}
                <form
                  onSubmit={handleSendMessage}
                  className={`room-sidebar-footer p-3 border-t shrink-0 ${
                    isDark ? "bg-[#111111] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                  }`}
                >
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Send message to room..."
                      maxLength={250}
                      className={`w-full border rounded-xl pl-3.5 pr-11 py-2.5 text-xs focus:outline-none focus:border-[#FF0000] transition ${
                        isDark
                          ? "bg-[#181818] border-[#272727] text-white placeholder-neutral-500"
                          : "bg-white border-[#E5E5E5] text-[#0F0F0F] placeholder-neutral-400"
                      }`}
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      className={`absolute right-2 p-1.5 rounded-lg transition active:scale-95 shadow-sm disabled:opacity-40 ${
                        isDark ? "bg-[#F1F1F1] hover:bg-white text-[#0F0F0F]" : "bg-[#0F0F0F] hover:bg-black text-white"
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
              <div className="room-sidebar-pane flex-1 flex flex-col justify-between p-4 overflow-hidden min-h-0 space-y-4">
                <div className="room-sidebar-scroll space-y-2.5 overflow-y-auto min-h-0">
                  <div className="flex items-center justify-between pb-1.5 border-b border-inherit">
                    <span className="text-xs font-bold">Room Members</span>
                    <span className="text-[11px] opacity-50 font-mono">3 / 50 Active</span>
                  </div>

                  {/* Host Card */}
                  <div className={`flex items-center justify-between p-3 rounded-2xl border ${
                    isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`relative w-9 h-9 rounded-xl border flex items-center justify-center font-bold text-xs ${
                        isDark ? "bg-[#272727] border-[#383838] text-white" : "bg-neutral-200 border-neutral-300 text-black"
                      }`}>
                        Y
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#181818]"></span>
                      </div>
                      <div>
                        <p className="text-xs font-bold">You (Host)</p>
                        <span className="text-[10px] text-neutral-400 font-mono font-medium tracking-wider">ROOM CREATOR</span>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border ${
                      isDark ? "bg-[#272727] border-[#383838] text-neutral-300" : "bg-[#E5E5E5] border-[#D5D5D5] text-neutral-800"
                    }`}>
                      YOU
                    </span>
                  </div>

                  {/* Moderator Card */}
                  <div className={`flex items-center justify-between p-3 rounded-2xl border ${
                    isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`relative w-9 h-9 rounded-xl border flex items-center justify-center font-bold text-xs ${
                        isDark ? "bg-[#272727] border-[#333] text-neutral-200" : "bg-[#E5E5E5] border-[#D5D5D5] text-neutral-800"
                      }`}>
                        M
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#181818]"></span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold">Maya</p>
                        <span className="text-[10px] opacity-60 font-mono">{memberRoles.maya}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => updateMemberRole("maya", memberRoles.maya === "MODERATOR" ? "VIEWER" : "MODERATOR")}
                      className={`px-2.5 py-1 text-[11px] rounded-lg transition font-medium ${
                        isDark ? "bg-[#272727] hover:bg-[#333] text-neutral-300" : "bg-[#E5E5E5] hover:bg-[#D5D5D5] text-neutral-700"
                      }`}
                    >
                      {memberRoles.maya === "MODERATOR" ? "Demote" : "Promote"}
                    </button>
                  </div>

                  {/* Participant Card */}
                  {!removedMembers.includes("liam") && (
                    <div className={`flex items-center justify-between p-3 rounded-2xl border ${
                    isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`relative w-9 h-9 rounded-xl border flex items-center justify-center font-bold text-xs ${
                        isDark ? "bg-[#272727] border-[#333] text-neutral-200" : "bg-[#E5E5E5] border-[#D5D5D5] text-neutral-800"
                      }`}>
                        L
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#181818]"></span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold">Liam</p>
                        <span className="text-[10px] opacity-60 font-mono">{memberRoles.liam}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => updateMemberRole("liam", memberRoles.liam === "MODERATOR" ? "VIEWER" : "MODERATOR")}
                        className={`px-2.5 py-1 text-[11px] rounded-lg transition font-medium ${
                          isDark ? "bg-[#272727] hover:bg-[#333] text-neutral-300" : "bg-[#E5E5E5] hover:bg-[#D5D5D5] text-neutral-700"
                        }`}
                      >
                        {memberRoles.liam === "MODERATOR" ? "Demote" : "Mod"}
                      </button>
                      <button
                        onClick={() => removeMember("liam")}
                        className="px-2.5 py-1 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 text-[11px] rounded-lg transition font-medium"
                      >
                        Kick
                      </button>
                    </div>
                    </div>
                  )}
                </div>

                {/* Bottom: Compact host permissions */}
                <div className="room-sidebar-footer pt-1.5 border-t border-inherit shrink-0">
                  <div className={`p-1.5 rounded-md border ${
                    isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F2F2F2] border-[#E5E5E5]"
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#FF0000] block"></span>
                      <span className="text-[9px] font-bold uppercase tracking-wider">Host Permissions</span>
                    </div>
                    <p className="mt-1 text-[9px] opacity-70 leading-[1.2]">
                      You and designated moderators have playback scrubbing, video changing, and room queue permissions.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Pane 3: Queue Pane (Fills vertical height cleanly, NO chat input) */}
            {currentTab === "queue" && (
              <div className="room-sidebar-pane flex-1 flex flex-col justify-between p-4 overflow-hidden min-h-0 space-y-4">
                <div className="room-sidebar-scroll space-y-3 overflow-y-auto min-h-0">
                  <div className={`p-3.5 rounded-2xl border space-y-2 ${
                    isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold font-mono tracking-wider opacity-60 uppercase flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Now Synchronized
                      </span>
                      <span className="text-[11px] font-mono opacity-60 font-medium">LIVE</span>
                    </div>
                    <div>
                      <p className="text-xs font-bold leading-snug">Lofi Girl — Beats to relax/study to</p>
                      <p className="text-[11px] opacity-60 mt-0.5">Streaming via YouTube 4K Sync</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pb-1 border-b border-inherit">
                    <span className="text-xs font-bold">Up Next</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-4 h-4 rounded-full text-[10px] font-mono font-medium flex items-center justify-center leading-none ${
                        isDark ? "bg-[#272727] text-white" : "bg-[#E5E5E5] text-black"
                      }`}>
                        3
                      </span>
                      <span className="text-[11px] opacity-60 font-medium">tracks queued</span>
                    </div>
                  </div>

                  {queueList.map((track) => (
                    <div
                      key={track.id}
                      className={`p-3 rounded-2xl border flex items-center justify-between ${
                        isDark ? "bg-[#181818] border-[#272727]" : "bg-[#F8F8F9] border-[#E5E5E5]"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <p className="text-xs font-semibold">{track.title}</p>
                        <span className="text-[10px] opacity-60">{track.req}</span>
                      </div>
                      <span className={`w-5 h-5 rounded-full border text-[10px] font-mono font-bold flex items-center justify-center shrink-0 ${
                        isDark ? "bg-[#272727] border-[#383838] text-neutral-300" : "bg-[#E5E5E5] border-[#D5D5D5] text-neutral-700"
                      }`}>
                        {track.id}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="room-sidebar-footer pt-3 border-t border-inherit space-y-2 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Queue Next Video</span>
                    <span className="text-[10px] opacity-60 font-medium">Autoplay On</span>
                  </div>
                  <button
                    onClick={openVideoModal}
                    className={`w-full py-2.5 px-3.5 rounded-xl border text-xs font-semibold transition flex items-center justify-center gap-2 shadow-sm ${
                      isDark
                        ? "bg-[#181818] hover:bg-[#222222] border-[#272727] text-white"
                        : "bg-[#F2F2F2] hover:bg-[#E5E5E5] border-[#E5E5E5] text-black"
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-[#FF0000] text-white flex items-center justify-center text-[11px] font-black">+</span>
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
                <h2 id="change-video-title">Change the video</h2>
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
              Paste a YouTube link to replace the current synchronized video for everyone in the room.
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
                  Load & sync <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* End Room Modal */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`max-w-sm w-full border p-6 rounded-3xl space-y-4 text-center shadow-2xl transition-colors ${
            isDark ? "bg-[#181818] border-[#272727] text-white" : "bg-white border-[#E5E5E5] text-[#0F0F0F]"
          }`}>
            <div className="w-12 h-12 rounded-2xl bg-[#FF0000]/10 text-[#FF0000] mx-auto flex items-center justify-center text-xl font-bold border border-[#FF0000]/30">
              !
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold">End Session for Everyone?</h3>
              <p className="text-xs opacity-60">All current participants will be disconnected immediately.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowEndModal(false)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition ${
                  isDark ? "bg-[#272727] hover:bg-[#333] text-[#F1F1F1]" : "bg-[#F2F2F2] hover:bg-[#E5E5E5] text-[#0F0F0F]"
                }`}
              >
                Stay
              </button>
              <button
                onClick={() => {
                  setShowEndModal(false);
                  showToastMsg("Room has ended.");
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
