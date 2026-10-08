"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, reset }) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <main className="missing-shell">
            <div className="missing-code">500</div>
            <p className="eyebrow"><span /> Something interrupted the room</p>
            <h1>Let&apos;s get you<br /><em>back in sync.</em></h1>
            <p className="missing-copy">The room could not load right now. Try again, or return to WatchSync and start fresh.</p>
            <div className="error-actions"><button className="primary-action missing-action" onClick={() => reset()} type="button">Try again <span>↗</span></button><Link className="secondary-action" href="/">Return home</Link></div>
        </main>
    );
}
