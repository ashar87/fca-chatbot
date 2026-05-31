"use client";

import { useState } from "react";
import { PortalSection } from "./NavTabs";

interface Props {
  activeSection: PortalSection;
  onSectionChange: (s: PortalSection) => void;
}

export default function Sidebar({ activeSection, onSectionChange }: Props) {
  const [nsmOpen, setNsmOpen] = useState(true);

  const isNsm = activeSection === "nsm-search" || activeSection === "nsm-about";

  return (
    <aside style={{ width: 220, flexShrink: 0 }}>
      {/* National Storage Mechanism section */}
      <div>
        <button
          className="sidebar-section-header w-full"
          onClick={() => setNsmOpen((o) => !o)}
        >
          <span>National Storage Mechanism</span>
          <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{nsmOpen ? "−" : "+"}</span>
        </button>

        {nsmOpen && (
          <div>
            <button
              className={`sidebar-item w-full${activeSection === "nsm-search" ? " active" : ""}`}
              onClick={() => onSectionChange("nsm-search")}
            >
              NSM Search
            </button>
            <button
              className={`sidebar-item w-full${activeSection === "nsm-about" ? " active" : ""}`}
              onClick={() => onSectionChange("nsm-about")}
            >
              About NSM
            </button>
          </div>
        )}
      </div>

      {/* List of Registers */}
      <div className="mt-3">
        <div className="sidebar-section-header" style={{ cursor: "default" }}>
          List of Registers
        </div>
        <button
          className={`sidebar-link w-full${activeSection === "firds" ? " active" : ""}`}
          onClick={() => onSectionChange("firds")}
        >
          Financial Instruments Reference Data System
        </button>
        <button
          className={`sidebar-link w-full${activeSection === "fitrs" ? " active" : ""}`}
          onClick={() => onSectionChange("fitrs")}
        >
          Financial Instruments Transparency System
        </button>
        <button
          className={`sidebar-link w-full${activeSection === "short-selling" ? " active" : ""}`}
          onClick={() => onSectionChange("short-selling")}
        >
          Short Selling Register
        </button>
        <span className="sidebar-link" style={{ color: "#888", cursor: "default" }}>
          Securitisations – STS Notifications
        </span>
        <span className="sidebar-link" style={{ color: "#888", cursor: "default" }}>
          Public Ratings Database – PRD
        </span>
        <span className="sidebar-link" style={{ color: "#888", cursor: "default" }}>
          Credit Rating Agency Details
        </span>
      </div>
    </aside>
  );
}
