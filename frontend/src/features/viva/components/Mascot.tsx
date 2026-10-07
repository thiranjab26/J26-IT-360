export type MascotState = "idle" | "speaking" | "listening" | "thinking" | "nodding";

const LABEL: Record<MascotState, string> = {
  idle: "Viva guide is waiting",
  speaking: "Viva guide is asking a question",
  listening: "Viva guide is listening",
  thinking: "Viva guide is thinking",
  nodding: "Viva guide acknowledges your answer",
};

/* Illustrated human examiner. Expressions are CSS-driven per state and deliberately
   non-evaluative: the face never signals whether an answer was right. */
export function Mascot({ state }: { state: MascotState }) {
  return (
    <div className={`st-mascot is-${state}`} role="img" aria-label={LABEL[state]}>
      <svg viewBox="0 0 220 230" width="190" height="200">
        <defs>
          <radialGradient id="av-bg" cx="50%" cy="45%" r="55%">
            <stop offset="0" stopColor="#e0e7ff" />
            <stop offset="1" stopColor="#e0e7ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="av-skin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f5c9a8" />
            <stop offset="1" stopColor="#e8ad88" />
          </linearGradient>
          <linearGradient id="av-hair" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3b2a24" />
            <stop offset="1" stopColor="#1f1512" />
          </linearGradient>
          <clipPath id="av-eye-l"><ellipse cx="88" cy="112" rx="10" ry="7" /></clipPath>
          <clipPath id="av-eye-r"><ellipse cx="132" cy="112" rx="10" ry="7" /></clipPath>
        </defs>
        <circle className="av-halo" cx="110" cy="112" r="104" fill="url(#av-bg)" />
        <g className="av-waves" fill="none" stroke="#818cf8" strokeWidth="3.5" strokeLinecap="round">
          <path d="M30 100 q-9 14 0 28" />
          <path d="M18 90 q-15 24 0 48" />
          <path d="M190 100 q9 14 0 28" />
          <path d="M202 90 q15 24 0 48" />
        </g>
        {/* shoulders and blazer */}
        <path d="M40 230 q8 -46 70 -52 q62 6 70 52 z" fill="#4338ca" />
        <path d="M92 180 l18 24 l18 -24 q-18 -6 -36 0 z" fill="#f8fafc" />
        <rect x="98" y="160" width="24" height="24" rx="8" fill="#e8ad88" />
        <g className="av-head">
          {/* back hair */}
          <path d="M58 112 q-4 -62 52 -66 q56 4 52 66 q2 30 -8 46 l-88 0 q-10 -16 -8 -46 z" fill="url(#av-hair)" />
          {/* face */}
          <ellipse cx="110" cy="114" rx="44" ry="52" fill="url(#av-skin)" />
          <ellipse cx="66" cy="118" rx="7" ry="11" fill="#e8ad88" />
          <ellipse cx="154" cy="118" rx="7" ry="11" fill="#e8ad88" />
          {/* fringe */}
          <path d="M66 100 q6 -42 46 -44 q40 2 44 40 q-24 -22 -52 -18 q-22 4 -38 22 z" fill="url(#av-hair)" />
          {/* brows */}
          <path className="av-brow av-brow-l" d="M77 99 q11 -4 22 0" stroke="#2a1d18" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path className="av-brow av-brow-r" d="M121 99 q11 -4 22 0" stroke="#2a1d18" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          {/* eyes: sclera, moving iris, blinking lid */}
          {[["l", 88], ["r", 132]].map(([side, x]) => (
            <g key={side as string}>
              <ellipse cx={x as number} cy="112" rx="10" ry="7" fill="#fff" />
              <g clipPath={`url(#av-eye-${side})`}>
                <g className="av-iris">
                  <circle cx={x as number} cy="113" r="7.5" fill="#5b3a29" />
                  <circle cx={x as number} cy="113" r="3.6" fill="#120c0a" />
                  <circle cx={(x as number) + 2.5} cy="110.5" r="1.8" fill="#fff" />
                </g>
                <rect className="av-lid" x={(x as number) - 12} y="103" width="24" height="18" fill="#eebd9b" />
              </g>
            </g>
          ))}
          {/* nose and cheeks */}
          <path d="M110 116 q-4 12 -1 16 q3 1 6 -1" stroke="#c98a66" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <ellipse cx="80" cy="134" rx="9" ry="5" fill="#f19c8b" opacity="0.35" />
          <ellipse cx="140" cy="134" rx="9" ry="5" fill="#f19c8b" opacity="0.35" />
          {/* mouth: smile (rest) and open (talking) */}
          <path className="av-smile" d="M93 141 q17 15 34 0" stroke="#a24a4a" strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <g className="av-talk">
            <ellipse cx="110" cy="146" rx="10" ry="6" fill="#7a2e33" />
            <ellipse cx="110" cy="150" rx="6" ry="2.5" fill="#e07a7a" />
          </g>
        </g>
        <g className="av-dots" fill="#6366f1">
          <circle cx="168" cy="44" r="5" />
          <circle cx="183" cy="32" r="5" />
          <circle cx="198" cy="20" r="5" />
        </g>
      </svg>
    </div>
  );
}
