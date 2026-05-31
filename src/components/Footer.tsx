export default function Footer() {
  return (
    <footer style={{ backgroundColor: "var(--fca-footer-bg)", color: "#ccc" }} className="mt-8">
      <div className="max-w-screen-xl mx-auto px-4 py-5 flex items-center justify-between text-xs">
        {/* Left */}
        <div>Copyright © {new Date().getFullYear()} FCA. All rights reserved.</div>

        {/* Centre — Back to top */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex flex-col items-center gap-1 text-white/70 hover:text-white"
            style={{ background: "none", border: "none", cursor: "pointer" }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: "50%",
                backgroundColor: "var(--fca-purple)",
                color: "white",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </span>
            <span className="text-xs text-white/60">Back to top</span>
          </button>
        </div>

        {/* Right */}
        <div className="flex flex-col items-end gap-1 text-white/60">
          <span>Company no. 01920623</span>
          <a href="#" className="hover:text-white" style={{ color: "inherit" }}>Contact us</a>
          <a href="#" className="hover:text-white" style={{ color: "inherit" }}>Cookies Notice</a>
        </div>
      </div>
    </footer>
  );
}
