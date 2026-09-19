"use client";

import { useMemo } from "react";
import type { Doctor } from "@/lib/protocol";
import { initials } from "./primitives";

/** Available doctors first, then alphabetical. */
function rank(doctor: Doctor): number {
  if (doctor.online && !doctor.busy) return 0;
  return doctor.online ? 1 : 2;
}

export function DoctorDirectory({
  doctors,
  query,
  onQueryChange,
  onCall,
  callInProgress,
}: {
  doctors: Doctor[];
  query: string;
  onQueryChange: (value: string) => void;
  onCall: (doctor: Doctor) => void;
  callInProgress: boolean;
}) {
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return doctors
      .filter(
        (doctor) =>
          !needle ||
          doctor.name.toLowerCase().includes(needle) ||
          doctor.specialty.toLowerCase().includes(needle),
      )
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [doctors, query]);

  const available = doctors.filter((doctor) => doctor.online && !doctor.busy).length;
  const count = query.trim()
    ? `${visible.length} of ${doctors.length} shown`
    : `${doctors.length} doctors · ${available} available`;

  return (
    <>
      <h2 className="section">Find a doctor</h2>
      <p className="section-sub">
        Search by name or specialty, then start a video consultation. Calls connect
        directly between you and the doctor.
      </p>

      <div className="search-row">
        <input
          type="search"
          placeholder="Search by doctor name or specialty…"
          autoComplete="off"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          data-testid="search"
        />
        <span className="count" data-testid="count">
          {count}
        </span>
      </div>

      <div className="doctors" data-testid="doctors">
        {visible.length === 0 ? (
          <div className="empty">No doctors match “{query.trim()}”.</div>
        ) : (
          visible.map((doctor) => {
            const status = doctor.busy
              ? { className: "pill busy", label: "In a consultation" }
              : doctor.online
                ? { className: "pill online", label: "Available now" }
                : { className: "pill", label: "Offline" };
            return (
              <div
                key={doctor.id}
                className={`doctor${doctor.online ? "" : " offline"}`}
                data-doctor={doctor.name}
              >
                <div className="avatar">{initials(doctor.name)}</div>
                <div className="doctor-body">
                  <div className="doctor-name">{doctor.name}</div>
                  <div className="doctor-spec">{doctor.specialty}</div>
                  <div className={status.className}>{status.label}</div>
                </div>
                <button
                  className="primary"
                  disabled={!doctor.online || doctor.busy || callInProgress}
                  onClick={() => onCall(doctor)}
                  data-testid="call"
                >
                  {doctor.busy ? "In call" : "Call"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}