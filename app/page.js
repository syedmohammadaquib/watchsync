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
    return Math.random().toString(36).slice(2, 8).toUpperCase();
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

export default function Home() {
    const router = useRouter();
    const theme = useTheme("dark");
    const [mode, setMode] = useState("create");
    const [name, setName] = useState("");
    const [roomCode, setRoomCode] = useState("");
    const [error, setError] = useState("");
    const [readyRoom, setReadyRoom] = useState(null);

    function handleSubmit(event) {
        event.preventDefault();
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
        const sessionId = mode === "create" ? crypto.randomUUID() : undefined;
        window.sessionStorage.setItem("watchsync-pending-join", JSON.stringify({ roomId: code, name: cleanName, mode, sessionId }));
        setReadyRoom({ code, name: cleanName });
    }

    function enterRoom() {
        router.push(`/room/${readyRoom.code}`);
    }

    return (
        <main className={`exact-home exact-${theme}`}>
            <div className="exact-perspective-stage" aria-hidden="true">
                <div className="exact-poster-grid">
                    {[0, 1, 2, 3, 4].map((column) => (
                        <div className={`exact-marquee-col exact-marquee-${column % 2 ? "down" : "up"} ${column > 2 ? "exact-hide-small" : ""}`} key={column}>
                            {[...videoData, ...videoData].map((item, index) => <PosterCard item={item} key={`${column}-${index}`} />)}
                        </div>
                    ))}
                </div>
            </div>
            <div className="exact-ambient exact-ambient-one" aria-hidden="true" />
            <div className="exact-ambient exact-ambient-two" aria-hidden="true" />
            <div className="exact-vignette" aria-hidden="true" />
            <div className="exact-main">
                <nav className="exact-topbar" aria-label="Primary navigation">
                    <div className="exact-brand"><span />watch<span>sync</span></div>
                    <div className="exact-tools">
                        <div className="exact-live-counter"><i />14,290 synchronized watchers</div>
                        <ThemeToggle defaultTheme={theme} />
                    </div>
                </nav>
                <section className="exact-landing-grid">
                    <div className="exact-copy">
                        <p className="exact-kicker"><i /> Press play. Stay together.</p>
                        <h1>Watch together.<br /><em>In perfect sync.</em></h1>
                        <p className="exact-description">Create a private room for YouTube videos, live streams, and playlists. Shared timeline with zero drift and instant synchronized play, pause, and seek.</p>
                        <div className="exact-features"><span>⚡ Sub-10ms Sync</span><span>▣ Live Chat &amp; Reactions</span><span>＋ Collaborative Queue</span></div>
                    </div>
                    <section className="exact-glass-panel" aria-labelledby="panel-title">
                        <div className="exact-panel-heading"><p>SESSION SETUP</p><h2 id="panel-title">{mode === "create" ? "Create a room" : "Join a room"}</h2></div>
                        <div className="exact-mode-switch" role="tablist">
                            <button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setError(""); }} type="button">Create Room</button>
                            <button className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setError(""); }} type="button">Join Room</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            {mode === "join" && <label>Room Code <span>e.g. A7K2QX</span><input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder="ENTER ROOM CODE" maxLength={8} autoCapitalize="characters" /></label>}
                            <label>Your Display Name<input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="e.g. Alex, Sarah..." maxLength={32} autoFocus /></label>
                            {error && <p className="exact-error" role="alert">ⓘ <span>{error}</span></p>}
                            <button className="exact-primary-action" type="submit">{mode === "create" ? "Create Watch Room" : "Enter Watch Room"} <span>→</span></button>
                        </form>
                        <div className="exact-privacy"><span>🔒 Private &amp; encrypted link</span><span>No signup needed</span></div>
                    </section>
                </section>
                <footer className="exact-footer"><span><i />WATCH TOGETHER, FROM ANYWHERE</span><b /><span>WATCHSYNC © 2026</span></footer>
            </div>
            {readyRoom && <div className="exact-modal-backdrop"><section className="exact-modal" role="dialog" aria-modal="true" aria-labelledby="ready-title"><header><h2 id="ready-title"><i /> ROOM READY</h2><button onClick={() => setReadyRoom(null)} type="button" aria-label="Close">✕</button></header><p>Share this code with your friends to start watching together:</p><strong>{readyRoom.code}</strong><small>Host User: <b>{readyRoom.name}</b></small><button onClick={enterRoom} type="button">Enter Watch Room</button></section></div>}
        </main>
    );
}
