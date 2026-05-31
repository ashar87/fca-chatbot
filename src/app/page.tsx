"use client";

import { useState } from "react";
import Header from "@/components/Header";
import NavBar from "@/components/NavBar";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import NSMSearchPage from "@/components/NSMSearchPage";
import FIRDSSearchPage from "@/components/FIRDSSearchPage";
import FITRSSearchPage from "@/components/FITRSSearchPage";
import ShortSellingPage from "@/components/ShortSellingPage";
import ChatWidget from "@/components/ChatWidget";
import { PortalSection } from "@/components/NavTabs";

function AboutNSM() {
  return (
    <div className="content-panel text-sm leading-relaxed" style={{ color: "var(--fca-text)" }}>
      <p className="mb-3">
        The National Storage Mechanism (NSM) is the FCA&apos;s official repository for regulated
        information disclosed by issuers of securities admitted to trading on UK regulated markets.
      </p>
      <p className="mb-3">
        The NSM stores and provides public access to regulated information including annual financial
        reports, half-yearly reports, interim management statements, major shareholding notifications,
        and other disclosures required under the Transparency Directive and related legislation.
      </p>
      <p>
        Use <strong>NSM Search</strong> in the sidebar to find and download filings by company name,
        LEI, filing type, or date range.
      </p>
    </div>
  );
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<PortalSection>("nsm-search");

  function renderContent() {
    switch (activeSection) {
      case "nsm-search":      return <NSMSearchPage />;
      case "nsm-about":       return <AboutNSM />;
      case "firds":           return <FIRDSSearchPage />;
      case "fitrs":           return <FITRSSearchPage />;
      case "short-selling":   return <ShortSellingPage />;
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />
      <NavBar />

      {/* Two-column layout */}
      <div className="flex-1 flex" style={{ alignItems: "flex-start" }}>
        <div className="flex w-full max-w-screen-xl mx-auto px-4 py-4 gap-4" style={{ alignItems: "flex-start" }}>
          <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} />
          <main className="flex-1 min-w-0">
            {renderContent()}
          </main>
        </div>
      </div>

      <Footer />
      <ChatWidget activeSection={activeSection} />
    </div>
  );
}
