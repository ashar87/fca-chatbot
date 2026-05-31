export default function NavBar() {
  return (
    <nav style={{ backgroundColor: "var(--fca-purple)" }} className="w-full">
      <div className="flex items-center justify-between px-4" style={{ minHeight: 36 }}>
        {/* Homepage link */}
        <a
          href="#"
          className="flex items-center gap-2 text-white text-sm py-2"
          style={{ textDecoration: "none" }}
          onClick={(e) => e.preventDefault()}
        >
          {/* Home icon */}
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7A1 1 0 003 11h1v6a1 1 0 001 1h4v-4h2v4h4a1 1 0 001-1v-6h1a1 1 0 00.707-1.707l-7-7z" />
          </svg>
          Homepage
        </a>

        {/* Print icon */}
        <button
          onClick={() => window.print()}
          className="text-white/80 hover:text-white py-2"
          title="Print this page"
          style={{ background: "none", border: "none", cursor: "pointer" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
