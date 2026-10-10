"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle, { useTheme } from "@/components/theme-toggle";

const videoData = [
    { title: "Lofi Hip Hop Radio - Beats to Relax / Study", tag: "LIVE", duration: "24/7", views: "28k watching", img: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=480&q=80" },
    { title: "Cyberpunk Night City Drive 4K HDR", tag: "4K", duration: "2:14:05", views: "1.4M views", img: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=480&q=80" },
    { title: "Interstellar Soundtrack Live Orchestra", tag: "HD", duration: "1:42:10", views: "890k views", img: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=480&q=80" },
    { title: "SpaceX Starship Orbital Launch Stream", tag: "LIVE", duration: "LIVE", views: "142k watching", img: "https://images.unsplash.com/photo-1517976487492-5750f3195933?auto=format&fit=crop&w=480&q=80" },
    { title: "4K Drone Footage of Icelandic Fjords", tag: "4K 60FPS", duration: "45:30", views: "520k views", img: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=480&q=80" },
    { title: "Tokyo Rain Walk - Heavy Atmospheric Sounds", tag: "4K", duration: "3:00:00", views: "2.1M views", img: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=480&q=80" },
    { title: "Electronic Music Festival Stage Live", tag: "HD", duration: "2:15:20", views: "410k views", img: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=480&q=80" },
    { title: "Synthesizer Studio Setup & Ambient Jam", tag: "HD", duration: "58:12", views: "310k views", img: "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=480&q=80" },
];

function makeRoomCode() {
    return crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
}

function PosterCard({ item }) {
    return (
        <article className="exact-poster-card">
            <img src={item.img} alt={item.title} />
            <div className="exact-poster-overlay">
                <div className="exact-poster-top"><span>{item.views}</span><b className={item.tag === "LIVE" ? "is-live" : ""}>{item.tag}</b></div>
                <div><strong>{item.title}</strong><small>Duration: {item.duration}</small></div>
            </div>
        </article>
    );
}

function getColumnPosters(column) {
    const offset = (column * 3) % videoData.length;
    const rotated = [...videoData.slice(offset), ...videoData.slice(0, offset)];
    return column % 2 === 0 ? rotated : [...rotated].reverse();
}

const SERVER_WAKE_TIMEOUT_MS = 120000;

export default function Home() {
    const router = useRouter();
    const theme = useTheme("dark");
    const [mode, setMode] = useState("create");
    const [name, setName] = useState("");
    const [roomCode, setRoomCode] = useState("");
    const [error, setError] = useState("");
    const [readyRoom, setReadyRoom] = useState(null);
    const [linkCopied, setLinkCopied] = useState(false);
    const [codeCopied, setCodeCopied] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState("connecting");

    async function handleSubmit(event) {
        event.preventDefault();
        if (isSubmitting) return;
        const cleanName = name.trim();
        const cleanCode = roomCode.trim().toUpperCase();
        if (!cleanName) {
            setError("Please enter your name before continuing.");
            return;
        }
        if (mode === "join" && cleanCode.length < 4) {
            setError("Please enter a valid room code.");
            return;
        }
        const code = mode === "create" ? makeRoomCode() : cleanCode;
        setIsSubmitting(true);
        setConnectionStatus("connecting");
        setError("");
        try {
            const deadline = Date.now() + SERVER_WAKE_TIMEOUT_MS;
            let response;
            let result;

            while (!response) {
                const remaining = deadline - Date.now();
                if (remaining <= 0) throw new Error("The server is taking longer than expected to start.");

                const controller = new AbortController();
                const timeout = window.setTimeout(() => controller.abort(), remaining);
                try {
                    response = await fetch(`${process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"}/session`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ roomId: code, name: cleanName, mode }),
                        signal: controller.signal,
                    });
                } catch (requestError) {
                    if (requestError.name === "AbortError") throw requestError;
                    setConnectionStatus("waking");
                    await new Promise((resolve) => window.setTimeout(resolve, Math.min(1500, Math.max(0, deadline - Date.now()))));
                    continue;
                } finally {
                    window.clearTimeout(timeout);
                }

                if (response.status >= 500) {
                    response = null;
                    setConnectionStatus("waking");
                    await new Promise((resolve) => window.setTimeout(resolve, Math.min(1500, Math.max(0, deadline - Date.now()))));
                    continue;
                }
                result = await response.json().catch(() => null);
            }

            if (!response.ok || !result?.ok) {
                if (response.status === 404 && mode === "join") throw new Error("Room not found.");
                throw new Error(result?.message || "Unable to prepare this room.");
            }
            window.sessionStorage.setItem(`watchsync-room-${code}`, JSON.stringify({ roomId: code, name: cleanName, mode }));
            setLinkCopied(false);
            setCodeCopied(false);
            setReadyRoom({ code, name: cleanName });
        } catch (requestError) {
            setError(requestError.name === "AbortError"
                ? "Server is still starting. Please try again."
                : requestError.message || "Unable to connect to the room.");
        } finally {
            setIsSubmitting(false);
            setConnectionStatus("connecting");
        }
    }

    function enterRoom() {
        router.push(`/room/${readyRoom.code}`);
    }

    async function copyRoomLink() {
        const roomUrl = `${window.location.origin}/room/${readyRoom.code}`;
        try {
            await navigator.clipboard.writeText(roomUrl);
            setLinkCopied(true);
            window.setTimeout(() => setLinkCopied(false), 2200);
        } catch {
            setError("Unable to copy the room link. Please copy the URL manually.");
        }
    }

    async function copyRoomCode(event) {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(readyRoom.code);
            setCodeCopied(true);
            window.setTimeout(() => setCodeCopied(false), 2000);
        } catch {
            setError("Unable to copy the room code. Please copy it manually.");
        }
    }

    return (
        <main className={`exact-home exact-${theme}`}>
            <div className="exact-perspective-stage" aria-hidden="true">
                <div className="exact-poster-grid">
                    {[0, 1, 2, 3, 4].map((column) => (
                        <div className={`exact-marquee-col exact-marquee-${column % 2 ? "down" : "up"} ${column > 2 ? "exact-hide-small" : ""}`} key={column}>
                            {[...getColumnPosters(column), ...getColumnPosters(column)].map((item, index) => <PosterCard item={item} key={`${column}-${index}`} />)}
                        </div>
                    ))}
                </div>
            </div>
            <div className="exact-ambient exact-ambient-one" aria-hidden="true" />
            <div className="exact-ambient exact-ambient-two" aria-hidden="true" />
            <div className="exact-vignette" aria-hidden="true" />
            <div className="exact-main">
                <nav className="exact-topbar" aria-label="Primary navigation">
                    <div className="exact-brand">
                        <img className="exact-brand-logo" src="/logo.png" alt="" aria-hidden="true" />
                        <span className="exact-brand-name"><span>watch</span><span>sync</span></span>
                    </div>
                    <div className="exact-tools">
                        <div className="exact-live-counter"><i />Synchronized YouTube playback</div>
                        <ThemeToggle defaultTheme={theme} />
                    </div>
                </nav>
                <section className="exact-landing-grid">
                    <div className="exact-copy">
                        <p className="exact-kicker"><i /> Ultra-Low Latency Sync Engine</p>
                        <h1>Watch together.<br /><em>In perfect sync.</em></h1>
                        <p className="exact-description">Create a private room for YouTube videos, live streams, and playlists. Shared timeline with zero drift and instant synchronized play, pause, and seek.</p>
                        <div className="exact-features" aria-label="WatchSync features">
                            <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg><b>Sub-10ms Sync</b></span>
                            <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></svg><b>Live Chat &amp; Reactions</b></span>
                            <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg><b>Collaborative Queue</b></span>
                        </div>
                    </div>
                    <section className="exact-glass-panel" aria-labelledby="panel-title">
                        <div className="exact-panel-edge" />
                        <div className="exact-panel-heading"><p>SESSION SETUP</p><h2 id="panel-title">{mode === "create" ? "Create a room" : "Join a room"}</h2></div>
                        <div className="exact-mode-switch" role="tablist">
                            <button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setRoomCode(""); setName(""); setError(""); }} type="button">Create Room</button>
                            <button className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setRoomCode(""); setName(""); setError(""); }} type="button">Join Room</button>
                        </div>
                        <form onSubmit={handleSubmit} autoComplete="off">
                            {mode === "join" && <label>Room Code<input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder="ENTER ROOM CODE" maxLength={8} autoCapitalize="characters" autoComplete="off" /></label>}
                            <label>Your Display Name<input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="e.g. Alex, Sarah..." maxLength={32} autoComplete="off" /></label>
                            <div className={`exact-action-group ${error ? "has-error" : ""} ${isSubmitting ? "is-connecting" : ""}`}>
                                {error && <p className="exact-error" role="alert"><span className="exact-error-icon" aria-hidden="true">!</span><span>{error}</span></p>}
                                {isSubmitting && <p className="exact-connection-status" role="status"><i />{connectionStatus === "waking" ? "Getting your room ready… This may take a moment." : "Connecting to the watch server…"}</p>}
                                <button className={`exact-primary-action ${isSubmitting && connectionStatus === "waking" ? "is-waking" : ""}`} type="submit" disabled={isSubmitting}>
                                    {isSubmitting ? connectionStatus === "waking" ? "Starting server" : "Connecting" : mode === "create" ? "Create Watch Room" : "Enter Watch Room"} <span className={isSubmitting ? "exact-loading-dots" : "exact-action-arrow"} aria-hidden="true">{isSubmitting ? "..." : <svg viewBox="0 0 24 24" focusable="false"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}</span>
                                </button>
                            </div>
                        </form>
                        <div className="exact-privacy"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10V7a4 4 0 0 1 8 0v3" /><rect x="5.5" y="10" width="13" height="10" rx="2.5" /><circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none" /><path d="M12 15.6v2.4" /></svg>Private &amp; encrypted link</span><span>No signup needed</span></div>
                    </section>
                </section>
                <footer className="exact-footer"><span><i />WATCH TOGETHER, FROM ANYWHERE</span><b /><span>WATCHSYNC © 2026</span></footer>
            </div>
            {readyRoom && <div className="exact-modal-backdrop" onClick={() => setReadyRoom(null)}>
                <section className="exact-modal" role="dialog" aria-modal="true" aria-labelledby="ready-title" onClick={(event) => event.stopPropagation()}>
                    <div className="exact-modal-edge" />
                    <header>
                        <div>
                            <p>SESSION SETUP</p>
                            <h2 id="ready-title">Room ready</h2>
                        </div>
                        <button className="exact-modal-close" onClick={() => setReadyRoom(null)} type="button" aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
                    </header>
                    <p className="exact-modal-message">Invite friends to watch together in synchronized real-time playback.</p>
                    <div className="exact-room-code">
                        <div><span>ROOM CODE</span><strong>{readyRoom.code}</strong></div>
                        <button className={codeCopied ? "copied" : ""} onClick={copyRoomCode} type="button">
                            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9" height="10" rx="1.5" /><path d="M12 7V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v8A1.5 1.5 0 0 0 4.5 14H7" /></svg>{codeCopied ? "Copied" : "Copy"}
                        </button>
                    </div>
                    <div className="exact-modal-actions">
                        <button className="exact-enter-room" onClick={enterRoom} type="button">
                            <span>Open Watch Room</span>
                        </button>
                        <button className={`exact-copy-link ${linkCopied ? "copied" : ""}`} onClick={copyRoomLink} type="button">
                            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9" height="10" rx="1.5" /><path d="M12 7V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v8A1.5 1.5 0 0 0 4.5 14H7" /></svg>{linkCopied ? "Link copied" : "Copy link"}
                        </button>
                    </div>
                    <div className="exact-modal-privacy">
                        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10V7a4 4 0 0 1 8 0v3" /><rect x="5.5" y="10" width="13" height="10" rx="2.5" /><circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none" /><path d="M12 15.6v2.4" /></svg>Private &amp; encrypted</span>
                        <span>No signup needed</span>
                    </div>
                </section>
            </div>}
        </main>
    );
}
