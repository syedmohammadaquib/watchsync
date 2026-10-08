import Link from "next/link";

export default function NotFound() {
    return (
        <main className="missing-shell">
            <div className="missing-code">404</div>
            <p className="eyebrow"><span /> Room not found</p>
            <h1>This room has<br /><em>left the chat.</em></h1>
            <p className="missing-copy">The link may be wrong, or this watch room may have closed. Start a new room and invite your people again.</p>
            <Link className="primary-action missing-action" href="/">Back to watchsync <span>↗</span></Link>
        </main>
    );
}
