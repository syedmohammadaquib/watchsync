"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle, { useTheme } from "@/components/theme-toggle";

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState("create");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const theme = useTheme("light");

  function handleSubmit(event) {
    event.preventDefault();
    const cleanName = name.trim();

    if (!cleanName) {
      setError("Tell us your name before joining the room.");
      return;
    }

    if (mode === "join" && roomCode.trim().length < 4) {
      setError("Enter a valid room code.");
      return;
    }

    const code = mode === "create" ? makeRoomCode() : roomCode.trim().toUpperCase();
    const sessionId = mode === "create" ? crypto.randomUUID() : undefined;
    window.sessionStorage.setItem("watchsync-pending-join", JSON.stringify({ roomId: code, name: cleanName, mode, sessionId }));
    router.push(`/room/${code}`);
  }

  return (
    <main className={`landing-shell theme-${theme}`}>
      <nav className="topbar" aria-label="Primary navigation">
        <div className="brand-mark"><span className="brand-dot" />watchsync</div>
        <div className="topbar-tools"><span className="topbar-note">Private rooms for shared screens</span><ThemeToggle defaultTheme={theme} /></div>
      </nav>

      <section className="landing-grid">
        <div className="intro-copy">
          <p className="eyebrow"><span /> Real-time watch rooms</p>
          <h1>Press play.<br /><em>Stay together.</em></h1>
          <p className="intro-text">A calm, shared space for watching YouTube with your people. One room, one timeline, no one left behind.</p>
          <div className="signal-row" aria-label="WatchSync features">
            <span><b>01</b> Synced playback</span>
            <span><b>02</b> Live requests</span>
            <span><b>03</b> Room chat</span>
          </div>
        </div>

        <div className="entry-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Start a session</p>
              <h2>{mode === "create" ? "Create a watch room" : "Join your watch room"}</h2>
            </div>
            <span className="panel-status"><i /> Live-ready</span>
          </div>

          <div className="mode-switch" role="tablist" aria-label="Room action">
            <button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setError(""); }} type="button">Create room</button>
            <button className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setError(""); }} type="button">Join room</button>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === "join" && <label>Room code<input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} placeholder="e.g. A7K2QX" maxLength={8} autoCapitalize="characters" /></label>}
            <label>Your name<input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="What should we call you?" maxLength={32} autoFocus /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-action" type="submit">{mode === "create" ? "Create room" : "Enter room"}<span>↗</span></button>
          </form>
          <p className="privacy-note"><span>⌁</span> Your room is invite-only. No account required.</p>
        </div>
      </section>

      <footer className="landing-footer"><span>WATCH TOGETHER, FROM ANYWHERE</span><span className="footer-line" /><span>01 / 01</span></footer>
    </main>
  );
}
