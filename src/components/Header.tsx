export default function Header() {
  return (
    <>
      {/* Demo banner */}
      <div style={{ backgroundColor: "#ffdd00", color: "#0b0c0c" }} className="text-xs text-center py-1 font-bold">
        DEMO — Not the official FCA Data Portal.{" "}
        <a href="https://data.fca.org.uk" target="_blank" rel="noopener noreferrer" className="underline">
          Visit data.fca.org.uk →
        </a>
      </div>

      {/* White header with FCA logo */}
      <div className="bg-white py-3 px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/fca-logo.png" alt="Financial Conduct Authority" height={56} style={{ height: 56, width: "auto" }} />
      </div>
    </>
  );
}
